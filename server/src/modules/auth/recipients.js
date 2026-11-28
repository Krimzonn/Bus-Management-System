import { pool } from "../../database/db.js";

// Public read-only interface of Identity & Access: ids of ACTIVE accounts that hold
// one of the given roles. Used to resolve role-based notification recipients.
export async function listActiveAccountIdsByRoles(roleKeys, executor = pool) {
  if (
    !Array.isArray(roleKeys) ||
    roleKeys.length === 0 ||
    roleKeys.some((role) => typeof role !== "string" || !role.trim())
  ) {
    return [];
  }
  const result = await executor.query(
    `SELECT u.id
     FROM iam_users AS u
     INNER JOIN iam_roles AS r ON r.id = u.role_id
     WHERE u.is_active AND r.role_key = ANY($1::text[])
     ORDER BY u.id`,
    [roleKeys],
  );
  return result.rows.map((row) => String(row.id));
}
