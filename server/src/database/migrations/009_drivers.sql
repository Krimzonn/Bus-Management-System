-- Slice 6: Drivers module owns drivers and licenses. No foreign keys to other
-- modules' tables. Profile data is limited to the name (D-08 is still open).
CREATE TABLE drivers_drivers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    license_number VARCHAR(30) NOT NULL,
    -- Same format as fleet_buses.required_license_category so the two can match.
    license_category VARCHAR(20) NOT NULL,
    -- A calendar date: the license is valid through the whole of this day.
    license_expiry_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT drivers_drivers_name_check CHECK (
        full_name = btrim(full_name) AND char_length(full_name) BETWEEN 1 AND 100
        AND full_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT drivers_drivers_license_format CHECK (
        license_number = upper(btrim(license_number))
        AND license_number ~ '^[A-Z0-9][A-Z0-9 /-]{0,29}$'
    ),
    CONSTRAINT drivers_drivers_category_format CHECK (
        license_category ~ '^[A-Z0-9][A-Z0-9 -]{0,19}$'
    ),
    CONSTRAINT drivers_drivers_expiry_range CHECK (
        license_expiry_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
    ),
    CONSTRAINT drivers_drivers_status_check CHECK (status IN ('available', 'on_leave', 'absent')),
    CONSTRAINT drivers_drivers_archive_consistency CHECK (
        (is_archived AND archived_at IS NOT NULL)
        OR (NOT is_archived AND archived_at IS NULL)
    )
);

-- License numbers are unique ignoring spaces, hyphens and slashes (letter case is
-- already fixed by the format check), including across archived rows.
CREATE UNIQUE INDEX drivers_drivers_license_key
    ON drivers_drivers ((translate(license_number, ' -/', '')));

CREATE INDEX idx_drivers_drivers_name ON drivers_drivers (full_name, id);
CREATE INDEX idx_drivers_drivers_archived_status ON drivers_drivers (is_archived, status);
CREATE INDEX idx_drivers_drivers_category ON drivers_drivers (license_category);
-- Serves expiry monitoring, which only looks at drivers that are not archived.
CREATE INDEX idx_drivers_drivers_expiry ON drivers_drivers (license_expiry_date, id)
    WHERE is_archived = FALSE;

-- Capabilities (IMPLEMENTATION_SLICES.md permission baseline):
-- Admin and Transportation Manager manage; Administrative Staff view only.
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-drivers'), ('manage-drivers')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'transportation_manager')
      AND c.capability_key IN ('view-drivers', 'manage-drivers'))
  OR (r.role_key = 'administrative_staff' AND c.capability_key = 'view-drivers')
ON CONFLICT DO NOTHING;

-- Least-privilege grants for the runtime role: no DELETE (archive, never delete).
-- The identity column needs no separate sequence grant. audit_logs privileges
-- were set by migration 008 and are not changed here.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON drivers_drivers TO bus_app;
        REVOKE DELETE, TRUNCATE ON drivers_drivers FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for drivers_drivers were skipped.';
    END IF;
END
$$;
