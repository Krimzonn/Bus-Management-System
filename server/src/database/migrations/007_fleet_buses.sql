-- Slice 4: Fleet module owns buses. No foreign keys to other modules' tables.
-- Default route/driver columns are intentionally not created here (see Slice 7).
CREATE TABLE fleet_buses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bus_number VARCHAR(30) NOT NULL,
    seating_capacity INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    required_license_category VARCHAR(20) NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Applies to archived rows too, so an archived bus number is never reused.
    CONSTRAINT fleet_buses_bus_number_key UNIQUE (bus_number),
    CONSTRAINT fleet_buses_bus_number_format CHECK (
        bus_number = upper(btrim(bus_number))
        AND bus_number ~ '^[A-Z0-9][A-Z0-9 /-]{0,29}$'
    ),
    CONSTRAINT fleet_buses_capacity_check CHECK (seating_capacity BETWEEN 1 AND 100),
    CONSTRAINT fleet_buses_status_check CHECK (status IN ('active', 'inactive', 'under_maintenance')),
    CONSTRAINT fleet_buses_category_format CHECK (
        required_license_category ~ '^[A-Z0-9][A-Z0-9 -]{0,19}$'
    ),
    CONSTRAINT fleet_buses_archive_consistency CHECK (
        (is_archived AND archived_at IS NOT NULL)
        OR (NOT is_archived AND archived_at IS NULL)
    )
);

CREATE INDEX idx_fleet_buses_archived_status ON fleet_buses (is_archived, status);
CREATE INDEX idx_fleet_buses_category ON fleet_buses (required_license_category);

-- Approved permission baseline (IMPLEMENTATION_SLICES.md):
-- Admin and Transportation Manager manage; Administrative Staff view only.
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-buses'), ('manage-buses')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'transportation_manager')
      AND c.capability_key IN ('view-buses', 'manage-buses'))
  OR (r.role_key = 'administrative_staff' AND c.capability_key = 'view-buses')
ON CONFLICT DO NOTHING;