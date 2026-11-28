-- Slice 12: Notifications module owns in-app notifications (AGENTS.md section 4).
-- recipient_id is an account id with no foreign key into Identity & Access
-- (module boundary, as in audit_logs). History is retained: rows are never
-- deleted, and the only permitted change is recording the first read time.
CREATE TABLE notifications_notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message VARCHAR(500) NOT NULL,
    entity_type VARCHAR(30),
    entity_id VARCHAR(40),
    -- Repeat-safety key for recurring checks. NULL means "never deduplicate".
    dedupe_key VARCHAR(200),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT notifications_notifications_recipient_check CHECK (recipient_id > 0),
    CONSTRAINT notifications_notifications_event_check CHECK (
        char_length(event_type) BETWEEN 1 AND 50
    ),
    CONSTRAINT notifications_notifications_title_check CHECK (
        char_length(btrim(title)) > 0
    ),
    CONSTRAINT notifications_notifications_message_check CHECK (
        char_length(btrim(message)) > 0
    ),
    CONSTRAINT notifications_notifications_entity_check CHECK (
        (entity_type IS NULL) = (entity_id IS NULL)
    )
);

-- At most one notification per recipient for a given dedupe key.
CREATE UNIQUE INDEX notifications_notifications_dedupe_key
    ON notifications_notifications (recipient_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- History list, newest first.
CREATE INDEX idx_notifications_recipient_history
    ON notifications_notifications (recipient_id, created_at DESC, id DESC);
-- Unread list and unread count.
CREATE INDEX idx_notifications_unread
    ON notifications_notifications (recipient_id)
    WHERE read_at IS NULL;

CREATE FUNCTION notifications_protect_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'notifications history is retained and cannot be deleted';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
        OR NEW.event_type IS DISTINCT FROM OLD.event_type
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.message IS DISTINCT FROM OLD.message
        OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
        OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
        OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    THEN
        RAISE EXCEPTION 'notifications history is retained; only the first read time can be recorded'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_no_delete_or_edit
    BEFORE UPDATE OR DELETE ON notifications_notifications
    FOR EACH ROW EXECUTE FUNCTION notifications_protect_history();

CREATE TRIGGER notifications_no_truncate
    BEFORE TRUNCATE ON notifications_notifications
    FOR EACH STATEMENT EXECUTE FUNCTION notifications_protect_history();

-- Capabilities (IMPLEMENTATION_SLICES.md baseline: "Own notifications" is Yes for
-- Admin, Administrative Staff, Transportation Manager, Driver and Applicant).
INSERT INTO iam_capabilities (capability_key)
VALUES ('view-own-notifications'), ('update-own-notifications')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
JOIN iam_capabilities c
  ON r.role_key IN ('admin', 'administrative_staff', 'transportation_manager', 'driver', 'applicant')
 AND c.capability_key IN ('view-own-notifications', 'update-own-notifications')
ON CONFLICT DO NOTHING;

-- Least-privilege runtime grants: no DELETE (history is retained).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bus_app') THEN
        GRANT SELECT, INSERT, UPDATE ON notifications_notifications TO bus_app;
        REVOKE DELETE, TRUNCATE ON notifications_notifications FROM bus_app;
    ELSE
        RAISE NOTICE 'Role bus_app not found; runtime grants for notifications_notifications were skipped.';
    END IF;
END
$$;