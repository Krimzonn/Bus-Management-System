-- Slice 11: Fuel module owns fuel purchase records (AGENTS.md section 4).
-- No foreign key into Fleet (module boundary, as in migrations 010-012): the bus is
-- verified through Fleet's public interface under a share lock. Buses are archived,
-- never deleted, so history cannot be orphaned. created_by/updated_by/archived_by are
-- account ids without a key into Identity & Access (as in audit_logs).
CREATE TABLE fuel_purchases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bus_id BIGINT NOT NULL,
    purchase_date DATE NOT NULL,
    liters NUMERIC(10, 2) NOT NULL,
    total_cost NUMERIC(12, 2) NOT NULL,
    odometer INTEGER NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    archived_by BIGINT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fuel_purchases_bus_check CHECK (bus_id > 0),
    CONSTRAINT fuel_purchases_date_check CHECK (
        purchase_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-30'
    ),
    CONSTRAINT fuel_purchases_liters_check CHECK (liters > 0),
    CONSTRAINT fuel_purchases_cost_check CHECK (total_cost >= 0),
    CONSTRAINT fuel_purchases_odometer_check CHECK (odometer BETWEEN 0 AND 9999999),
    CONSTRAINT fuel_purchases_actor_check CHECK (
        created_by > 0 AND updated_by > 0 AND (archived_by IS NULL OR archived_by > 0)
    ),
    CONSTRAINT fuel_purchases_archive_consistency CHECK (
        (archived_at IS NULL) = (archived_by IS NULL)
    )
);

-- Active readings per bus in chronological order (odometer checks and efficiency).
CREATE INDEX idx_fuel_purchases_active_sequence
    ON fuel_purchases (bus_id, purchase_date, odometer, id)
    WHERE archived_at IS NULL;
-- Full bus history, including archived records.
CREATE INDEX idx_fuel_purchases_bus_history
    ON fuel_purchases (bus_id, purchase_date, odometer, id);
CREATE INDEX idx_fuel_purchases_date ON fuel_purchases (purchase_date DESC, id DESC);
CREATE INDEX idx_fuel_purchases_active ON fuel_purchases (purchase_date DESC, id DESC)
    WHERE archived_at IS NULL;

-- Database-level backstop for the odometer rule. Active readings of one bus must not
-- decrease across purchase dates (equal readings and same-date readings are allowed).
-- The advisory lock key is the same one the application takes, so writers of one bus
-- are serialised. Archived rows are not part of the active sequence.
CREATE FUNCTION fuel_check_odometer_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.archived_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('fuel:bus:' || NEW.bus_id::text, 0));
    IF EXISTS (
        SELECT 1 FROM fuel_purchases f
        WHERE f.bus_id = NEW.bus_id
          AND f.archived_at IS NULL
          AND f.id IS DISTINCT FROM NEW.id
          AND ((f.purchase_date < NEW.purchase_date AND f.odometer > NEW.odometer)
            OR (f.purchase_date > NEW.purchase_date AND f.odometer < NEW.odometer))
    ) THEN
        RAISE EXCEPTION 'fuel odometer readings must not decrease chronologically'
            USING ERRCODE = '23514', CONSTRAINT = 'fuel_purchases_odometer_sequence';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER fuel_purchases_odometer_sequence
    BEFORE INSERT OR UPDATE ON fuel_purchases
    FOR EACH ROW EXECUTE FUNCTION fuel_check_odometer_sequence();

-- Capabilities. Admin, Administrative Staff and Transportation Manager view and
-- manage (create/update); only Admin archives (same as maintenance, migration 014).
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-fuel'), ('manage-fuel'), ('archive-fuel')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'administrative_staff', 'transportation_manager')
      AND c.capability_key IN ('view-fuel', 'manage-fuel'))
  OR (r.role_key = 'admin' AND c.capability_key = 'archive-fuel')
ON CONFLICT DO NOTHING;

-- Least-privilege runtime grants: no DELETE (archive, never delete).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON fuel_purchases TO bus_app;
        REVOKE DELETE, TRUNCATE ON fuel_purchases FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for fuel_purchases were skipped.';
    END IF;
END
$$;