-- FR-REC-01–05, BR-08. External module IDs are references, not cross-module FKs.
CREATE TABLE recruitment_applications (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 applicant_id BIGINT NOT NULL UNIQUE CHECK (applicant_id > 0),
 applicant_email VARCHAR(255) NOT NULL,
 full_name VARCHAR(100) NOT NULL CHECK (length(btrim(full_name)) > 0),
 experience VARCHAR(255) NOT NULL CHECK (length(btrim(experience)) > 0),
 status VARCHAR(30) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','test_interview','selected','rejected')),
 interview_date DATE,
 interview_notes VARCHAR(255),
 interview_outcome VARCHAR(20) CHECK (interview_outcome IN ('passed','failed','completed')),
 decision_reason VARCHAR(255),
 driver_id BIGINT UNIQUE CHECK (driver_id > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (driver_id IS NULL OR status = 'selected'),
 CHECK (status NOT IN ('selected','rejected') OR interview_outcome IS NOT NULL),
 CHECK (interview_outcome IS NULL OR (interview_date IS NOT NULL AND interview_notes IS NOT NULL)),
 CHECK (status NOT IN ('submitted','under_review') OR (interview_date IS NULL AND interview_notes IS NULL AND interview_outcome IS NULL)),
 CHECK (status IN ('selected','rejected') OR decision_reason IS NULL)
);
CREATE TABLE recruitment_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 application_id BIGINT NOT NULL REFERENCES recruitment_applications(id),
 actor_id BIGINT NOT NULL CHECK (actor_id > 0),
 event VARCHAR(30) NOT NULL,
 previous_status VARCHAR(30),
 new_status VARCHAR(30) NOT NULL,
 details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION prevent_recruitment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'recruitment_history is append-only';
END; $$;
CREATE TRIGGER recruitment_history_no_update_delete BEFORE UPDATE OR DELETE ON recruitment_history FOR EACH ROW EXECUTE FUNCTION prevent_recruitment_history_mutation();
CREATE TRIGGER recruitment_history_no_truncate BEFORE TRUNCATE ON recruitment_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_recruitment_history_mutation();
CREATE INDEX recruitment_history_application_idx ON recruitment_history(application_id,id);
CREATE INDEX recruitment_application_status_idx ON recruitment_applications(status,id);
INSERT INTO iam_capabilities(capability_key) VALUES ('apply-recruitment'),('view-recruitment'),('manage-recruitment') ON CONFLICT DO NOTHING;
INSERT INTO iam_role_capabilities(role_id,capability_id)
SELECT r.id,c.id FROM iam_roles r CROSS JOIN iam_capabilities c WHERE
 (r.role_key='applicant' AND c.capability_key='apply-recruitment') OR
 (r.role_key='admin' AND c.capability_key IN ('view-recruitment','manage-recruitment')) OR
 (r.role_key='transportation_manager' AND c.capability_key='view-recruitment') ON CONFLICT DO NOTHING;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bus_app') THEN
 GRANT SELECT,INSERT,UPDATE ON recruitment_applications TO bus_app;
 GRANT SELECT,INSERT ON recruitment_history TO bus_app;
 REVOKE DELETE,TRUNCATE ON recruitment_applications FROM bus_app;
 REVOKE UPDATE,DELETE,TRUNCATE ON recruitment_history FROM bus_app;
END IF; END $$;
