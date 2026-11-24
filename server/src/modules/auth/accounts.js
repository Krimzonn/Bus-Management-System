import { pool } from "../../database/db.js";
import { hashPassword } from "./passwords.js";

const MIN_PASSWORD_LENGTH = 12;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateAccountId(id) {
  return typeof id === "string" && /^\d+$/.test(id) && Number(id) > 0;
}

function createError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function sanitizeAccount(row) {
  return {
    id: String(row.id),
    email: row.email,
    role: row.role_key ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACCOUNT_SELECT = `
  SELECT
    u.id,
    u.email,
    u.is_active,
    u.created_at,
    u.updated_at,
    r.role_key
  FROM iam_users u
  LEFT JOIN iam_roles r ON r.id = u.role_id
`;

export async function createInternalAccount({ email, password }) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    throw createError("INVALID_EMAIL", 400);
  }

  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw createError("INVALID_PASSWORD", 400);
  }

  const passwordHash = await hashPassword(password);

  try {
    const result = await pool.query(
      `INSERT INTO iam_users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, is_active, created_at, updated_at`,
      [normalizedEmail, passwordHash],
    );

    return sanitizeAccount({
      ...result.rows[0],
      role_key: null,
    });
  } catch (error) {
    if (error.code === "23505") {
      throw createError("ACCOUNT_ALREADY_EXISTS", 409);
    }

    throw error;
  }
}

export async function listInternalAccounts() {
  const result = await pool.query(`${ACCOUNT_SELECT} ORDER BY u.id`);

  return result.rows.map(sanitizeAccount);
}

export async function getInternalAccount(id) {
  if (!validateAccountId(id)) {
    throw createError("INVALID_ACCOUNT_ID", 400);
  }

  const result = await pool.query(`${ACCOUNT_SELECT} WHERE u.id = $1`, [id]);

  if (result.rows.length === 0) {
    throw createError("ACCOUNT_NOT_FOUND", 404);
  }

  return sanitizeAccount(result.rows[0]);
}

export async function updateInternalAccount({ id, email }) {
  if (!validateAccountId(id)) {
    throw createError("INVALID_ACCOUNT_ID", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    throw createError("INVALID_EMAIL", 400);
  }

  try {
    const result = await pool.query(
      `UPDATE iam_users
       SET email = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, email, is_active, created_at, updated_at`,
      [normalizedEmail, id],
    );

    if (result.rows.length === 0) {
      throw createError("ACCOUNT_NOT_FOUND", 404);
    }

    return getInternalAccount(id);
  } catch (error) {
    if (error.code === "23505") {
      throw createError("ACCOUNT_ALREADY_EXISTS", 409);
    }

    throw error;
  }
}

export async function assignInternalRole({ id, roleKey, actorId }) {
  if (!validateAccountId(id)) {
    throw createError("INVALID_ACCOUNT_ID", 400);
  }

  if (String(id) === String(actorId)) {
    throw createError("SELF_ROLE_CHANGE_FORBIDDEN", 403);
  }

  if (typeof roleKey !== "string" || roleKey.trim() === "") {
    throw createError("INVALID_ROLE", 400);
  }

  const roleResult = await pool.query(
    `SELECT id FROM iam_roles WHERE role_key = $1`,
    [roleKey],
  );

  if (roleResult.rows.length === 0) {
    throw createError("ROLE_NOT_FOUND", 404);
  }

  const result = await pool.query(
    `UPDATE iam_users
     SET role_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id`,
    [roleResult.rows[0].id, id],
  );

  if (result.rows.length === 0) {
    throw createError("ACCOUNT_NOT_FOUND", 404);
  }

  return getInternalAccount(id);
}

export async function setInternalAccountActive({ id, isActive, actorId }) {
  if (!validateAccountId(id)) {
    throw createError("INVALID_ACCOUNT_ID", 400);
  }

  if (String(id) === String(actorId) && isActive === false) {
    throw createError("SELF_DEACTIVATION_FORBIDDEN", 403);
  }

  if (typeof isActive !== "boolean") {
    throw createError("INVALID_ACCOUNT_STATUS", 400);
  }

  const result = await pool.query(
    `UPDATE iam_users
     SET is_active = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id`,
    [isActive, id],
  );

  if (result.rows.length === 0) {
    throw createError("ACCOUNT_NOT_FOUND", 404);
  }

  return getInternalAccount(id);
}
