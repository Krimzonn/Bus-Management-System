import { pool } from "../../database/db.js";

/**
 * Converts database rows into the role-capability mapping
 * expected by the authorization policy.
 *
 * @param {Array} rows
 * @returns {Object}
 */
export function buildRoleCapabilities(rows) {
  const roleCapabilities = {};
  if (!Array.isArray(rows)) {
    return roleCapabilities;
  }

  for (const row of rows) {
    if (
      typeof row.role_key !== "string" ||
      typeof row.capability_key !== "string"
    ) {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(roleCapabilities, row.role_key)) {
      roleCapabilities[row.role_key] = [];
    }

    if (!roleCapabilities[row.role_key].includes(row.capability_key)) {
      roleCapabilities[row.role_key].push(row.capability_key);
    }
  }

  return roleCapabilities;
}

/**
 * Loads the approved role-capability assignments from PostgreSQL.
 *
 * No assignments are created automatically.
 */
export async function loadRoleCapabilities() {
  const result = await pool.query(`
    SELECT
      roles.role_key,
      capabilities.capability_key
    FROM iam_role_capabilities AS assignments
    INNER JOIN iam_roles AS roles
      ON assignments.role_id = roles.id
    INNER JOIN iam_capabilities AS capabilities
      ON assignments.capability_id = capabilities.id
    ORDER BY roles.role_key, capabilities.capability_key
  `);

  return buildRoleCapabilities(result.rows);
}

// True only for an existing, active account whose role holds the capability.
export async function userHasCapability(userId, capability, executor = pool) {
  const result = await executor.query(
    `SELECT 1
     FROM iam_users AS u
     INNER JOIN iam_role_capabilities AS assignments ON assignments.role_id = u.role_id
     INNER JOIN iam_capabilities AS capabilities ON capabilities.id = assignments.capability_id
     WHERE u.id = $1 AND u.is_active AND capabilities.capability_key = $2`,
    [userId, capability],
  );
  return result.rows.length > 0;
}
