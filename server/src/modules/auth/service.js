import { pool } from "../../database/db.js";
import { verifyPassword } from "./passwords.js";

export async function authenticateUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await pool.query(
    `SELECT
       users.id,
       users.email,
       users.password_hash,
       users.is_active,
       roles.role_key
     FROM iam_users AS users
     LEFT JOIN iam_roles AS roles
       ON users.role_id = roles.id
     WHERE users.email = $1`,
    [normalizedEmail],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return null;
  }

  const passwordValid = await verifyPassword(user.password_hash, password);

  if (!passwordValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role_key,
  };
}
