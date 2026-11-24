-- Approved D-02 decision:
-- Only Admin can manage internal accounts and assign roles.

INSERT INTO iam_roles (role_key)
VALUES
    ('admin'),
    ('administrative_staff'),
    ('transportation_manager'),
    ('driver'),
    ('applicant'),
    ('passenger')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO iam_capabilities (capability_key)
VALUES
    ('manage-internal-accounts'),
    ('assign-internal-roles')
ON CONFLICT (capability_key) DO NOTHING;

-- Grant both account-management capabilities exclusively to Admin.
INSERT INTO iam_role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM iam_roles r
CROSS JOIN iam_capabilities c
WHERE r.role_key = 'admin'
AND c.capability_key IN (
    'manage-internal-accounts',
    'assign-internal-roles'
)
ON CONFLICT DO NOTHING;

-- Assign the initial account to Admin only when exactly one account
-- exists and no Admin account has already been assigned.
UPDATE iam_users
SET role_id = (
    SELECT id
    FROM iam_roles
    WHERE role_key = 'admin'
)
WHERE role_id IS NULL
AND (SELECT COUNT(*) FROM iam_users) = 1
AND NOT EXISTS (
    SELECT 1
    FROM iam_users u
    JOIN iam_roles r ON r.id = u.role_id
    WHERE r.role_key = 'admin'
);