-- Slice 7: Scheduling module owns schedules. No foreign keys to other modules'
-- tables; eligibility is checked through their public interfaces (ADR-004).

-- Lets a GiST exclusion constraint compare BIGINT ids with "=". btree_gist is a
-- trusted extension (PostgreSQL 13+): the migration role needs CREATE privilege
-- on the database, not superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- travel_date, departure_time and arrival_time are wall-clock values in the
-- business time zone (BUSINESS_TIMEZONE), matching the calendar-date convention
-- used for license expiry. An arrival earlier than departure is on the next day.
CREATE TABLE scheduling_schedules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    travel_date DATE NOT NULL,
    departure_time TIME NOT NULL,
    arrival_time TIME NOT NULL,
    bus_id BIGINT NOT NULL,
    driver_id BIGINT NOT NULL,
    route_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    -- Half-open [departure, arrival), so back-to-back trips do not overlap.
    trip_period TSRANGE GENERATED ALWAYS AS (
        tsrange(
            travel_date + departure_time,
            (travel_date + CASE WHEN arrival_time < departure_time THEN 1 ELSE 0 END) + arrival_time,
            '[)'
        )
    ) STORED,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT scheduling_schedules_date_range CHECK (
        travel_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-30'
    ),
    -- Whole minutes only; 24:00 is not a valid time of day here.
    CONSTRAINT scheduling_schedules_time_format CHECK (
        departure_time < TIME '24:00' AND arrival_time < TIME '24:00'
        AND EXTRACT(SECOND FROM departure_time) = 0
        AND EXTRACT(SECOND FROM arrival_time) = 0
    ),
    CONSTRAINT scheduling_schedules_distinct_times CHECK (departure_time <> arrival_time),
    CONSTRAINT scheduling_schedules_ids_check CHECK (bus_id > 0 AND driver_id > 0 AND route_id > 0),
    CONSTRAINT scheduling_schedules_status_check CHECK (
        status IN ('scheduled', 'in_progress', 'completed', 'cancelled')
    ),
    CONSTRAINT scheduling_schedules_lifecycle_check CHECK (
        (status = 'scheduled'
            AND started_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'in_progress'
            AND started_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'completed'
            AND started_at IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled'
            AND started_at IS NULL AND completed_at IS NULL AND cancelled_at IS NOT NULL)
    ),

    -- The authoritative clash rule. Enforced by PostgreSQL, so it also holds for
    -- concurrent transactions. Cancelled and completed trips do not block.
    CONSTRAINT scheduling_schedules_bus_overlap EXCLUDE USING gist (
        bus_id WITH =, trip_period WITH &&
    ) WHERE (status IN ('scheduled', 'in_progress')),
    CONSTRAINT scheduling_schedules_driver_overlap EXCLUDE USING gist (
        driver_id WITH =, trip_period WITH &&
    ) WHERE (status IN ('scheduled', 'in_progress'))
);

CREATE INDEX idx_scheduling_schedules_date
    ON scheduling_schedules (travel_date, departure_time, id);
CREATE INDEX idx_scheduling_schedules_driver
    ON scheduling_schedules (driver_id, travel_date, departure_time, id);
CREATE INDEX idx_scheduling_schedules_bus ON scheduling_schedules (bus_id, travel_date);
CREATE INDEX idx_scheduling_schedules_route ON scheduling_schedules (route_id, travel_date);
CREATE INDEX idx_scheduling_schedules_status ON scheduling_schedules (status, travel_date);

-- Capabilities (IMPLEMENTATION_SLICES.md permission baseline): Admin and
-- Transportation Manager manage (including start/complete); Administrative Staff
-- view only; Drivers view and operate their own trips only.
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-schedules'), ('manage-schedules'), ('view-own-trips'), ('operate-own-trips')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'transportation_manager')
      AND c.capability_key IN ('view-schedules', 'manage-schedules'))
  OR (r.role_key = 'administrative_staff' AND c.capability_key = 'view-schedules')
  OR (r.role_key = 'driver' AND c.capability_key IN ('view-own-trips', 'operate-own-trips'))
ON CONFLICT DO NOTHING;

-- Least-privilege runtime grants: no DELETE (schedule history is preserved).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON scheduling_schedules TO bus_app;
        REVOKE DELETE, TRUNCATE ON scheduling_schedules FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for scheduling_schedules were skipped.';
    END IF;
END
$$;
