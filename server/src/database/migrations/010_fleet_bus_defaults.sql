-- Slice 7: optional default route and driver on a bus (resolves D-04).
-- Fleet only stores these ids. They deliberately have no foreign keys into the
-- Routes or Drivers tables (Fleet must not depend on those modules). Scheduling
-- validates a default at the moment it uses it, so a stale or unknown id can
-- never produce an assignment. Table grants from the existing setup cover the
-- new columns.
ALTER TABLE fleet_buses
    ADD COLUMN default_route_id BIGINT,
    ADD COLUMN default_driver_id BIGINT,
    ADD CONSTRAINT fleet_buses_default_route_check CHECK (default_route_id > 0),
    ADD CONSTRAINT fleet_buses_default_driver_check CHECK (default_driver_id > 0);
