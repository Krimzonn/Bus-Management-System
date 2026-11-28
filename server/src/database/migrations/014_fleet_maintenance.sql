-- Slice 10: Fleet owns maintenance records (ARCHITECTURE.md section 5.2).
-- Same-module foreign key to fleet_buses. ON DELETE RESTRICT: history is never
-- cascaded away. created_by/updated_by/archived_by are account ids without a
-- foreign key into Identity & Access (module boundary, as in audit_logs).
CREATE TABLE fleet_maintenance_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bus_id BIGINT NOT NULL REFERENCES fleet_buses (id) ON DELETE RESTRICT,
    service_date DATE NOT NULL,
    maintenance_type VARCHAR(100) NOT NULL,
    work_description VARCHAR(255) NOT NULL,
    cost NUMERIC(12, 2) NOT NULL,
    odometer INTEGER,
    next_service_date DATE,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    archived_by BIGINT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fleet_maintenance_type_check CHECK (
        maintenance_type = btrim(maintenance_type)
        AND char_length(maintenance_type) BETWEEN 1 AND 100
        AND maintenance_type !~ '[[:cntrl:]]'
    ),
    CONSTRAINT fleet_maintenance_description_check CHECK (
        work_description = btrim(work_description)
        AND char_length(work_description) BETWEEN 1 AND 255
        AND work_description !~ '[[:cntrl:]]'
    ),
    CONSTRAINT fleet_maintenance_cost_check CHECK (cost >= 0),
    CONSTRAINT fleet_maintenance_odometer_check CHECK (
        odometer IS NULL OR odometer BETWEEN 0 AND 9999999
    ),
    CONSTRAINT fleet_maintenance_service_date_check CHECK (
        service_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-30'
    ),
    CONSTRAINT fleet_maintenance_next_date_check CHECK (
        next_service_date IS NULL
        OR (next_service_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-30'
            AND next_service_date >= service_date)
    ),
    CONSTRAINT fleet_maintenance_actor_check CHECK (
        created_by > 0 AND updated_by > 0 AND (archived_by IS NULL OR archived_by > 0)
    ),
    CONSTRAINT fleet_maintenance_archive_consistency CHECK (
        (archived_at IS NULL) = (archived_by IS NULL)
    )
);

-- Bus history, newest service first.
CREATE INDEX idx_fleet_maintenance_bus_history
    ON fleet_maintenance_records (bus_id, service_date DESC, id DESC);
CREATE INDEX idx_fleet_maintenance_service_date
    ON fleet_maintenance_records (service_date DESC, id DESC);
-- Upcoming/overdue review only looks at active records with a next date.
CREATE INDEX idx_fleet_maintenance_due
    ON fleet_maintenance_records (next_service_date, id)
    WHERE archived_at IS NULL AND next_service_date IS NOT NULL;
CREATE INDEX idx_fleet_maintenance_active
    ON fleet_maintenance_records (service_date DESC, id DESC)
    WHERE archived_at IS NULL;

-- Capabilities. Admin, Administrative Staff and Transportation Manager view and
-- manage (create/update); only Admin archives (baseline lists create/view/edit
-- for the other two roles).
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-maintenance'), ('manage-maintenance'), ('archive-maintenance')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'administrative_staff', 'transportation_manager')
      AND c.capability_key IN ('view-maintenance', 'manage-maintenance'))
  OR (r.role_key = 'admin' AND c.capability_key = 'archive-maintenance')
ON CONFLICT DO NOTHING;

-- Least-privilege runtime grants: no DELETE (archive, never delete).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON fleet_maintenance_records TO bus_app;
        REVOKE DELETE, TRUNCATE ON fleet_maintenance_records FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for fleet_maintenance_records were skipped.';
    END IF;
END
$$;