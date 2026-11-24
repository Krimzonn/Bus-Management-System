
-- Identity & Access owns these tables.
-- D-02: Do not insert role-to-capability assignments until approved.

CREATE TABLE IF NOT EXISTS iam_roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_key VARCHAR(80) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS iam_capabilities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    capability_key VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS iam_role_capabilities (
    role_id BIGINT NOT NULL REFERENCES iam_roles(id),
    capability_id BIGINT NOT NULL REFERENCES iam_capabilities(id),

    PRIMARY KEY (role_id, capability_id)
);
