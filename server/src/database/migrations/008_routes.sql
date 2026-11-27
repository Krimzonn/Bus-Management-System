-- Slice 5: Routes module owns routes. No foreign keys to other modules' tables.
-- Route codes are unique across archived rows too, so a code is never reused.
CREATE TABLE routes_routes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_code VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    origin VARCHAR(100) NOT NULL,
    destination VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unblocked',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT routes_routes_code_key UNIQUE (route_code),
    CONSTRAINT routes_routes_code_format CHECK (
        route_code = upper(btrim(route_code))
        AND route_code ~ '^[A-Z0-9][A-Z0-9 /-]{0,29}$'
    ),
    CONSTRAINT routes_routes_name_check CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100 AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT routes_routes_origin_check CHECK (
        origin = btrim(origin) AND char_length(origin) BETWEEN 1 AND 100 AND origin !~ '[[:cntrl:]]'
    ),
    CONSTRAINT routes_routes_destination_check CHECK (
        destination = btrim(destination) AND char_length(destination) BETWEEN 1 AND 100
        AND destination !~ '[[:cntrl:]]'
    ),
    CONSTRAINT routes_routes_status_check CHECK (status IN ('unblocked', 'blocked')),
    CONSTRAINT routes_routes_archive_consistency CHECK (
        (is_archived AND archived_at IS NOT NULL)
        OR (NOT is_archived AND archived_at IS NULL)
    )
);

CREATE INDEX idx_routes_routes_archived_status ON routes_routes (is_archived, status);
-- Serves the "selectable for new assignments" query.
CREATE INDEX idx_routes_routes_selectable ON routes_routes (route_code)
    WHERE is_archived = FALSE AND status = 'unblocked';

-- Capabilities (IMPLEMENTATION_SLICES.md permission baseline):
-- Admin and Transportation Manager manage; Administrative Staff view only.
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-routes'), ('manage-routes')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON (r.role_key IN ('admin', 'transportation_manager')
      AND c.capability_key IN ('view-routes', 'manage-routes'))
  OR (r.role_key = 'administrative_staff' AND c.capability_key = 'view-routes')
ON CONFLICT DO NOTHING;

-- Least-privilege grants for the runtime role. The migration role owns the
-- tables, so the runtime role needs explicit grants. Skipped if the role does
-- not exist (for example in a throwaway database).
-- routes_routes: no DELETE (archive, never delete).
-- audit_logs: append-only. INSERT (+ SELECT for the Admin audit view) only,
-- and UPDATE/DELETE/TRUNCATE are explicitly revoked. Identity columns need no
-- separate sequence grant.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON routes_routes TO bus_app;
        GRANT SELECT, INSERT ON audit_logs TO bus_app;
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for routes_routes and audit_logs were skipped.';
    END IF;
END
$$;