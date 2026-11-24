import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict } from "../audit/writer.js";
import { hashPassword } from "./passwords.js";

const MIN_PASSWORD_LENGTH = 12;
function normalizeEmail(email) { return typeof email === "string" ? email.trim().toLowerCase() : ""; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validateAccountId(id) { return typeof id === "string" && /^\d+$/.test(id) && Number(id) > 0; }
function createError(code, status) { const error = new Error(code); error.code = code; error.status = status; return error; }
function sanitizeAccount(row) {
  return { id: String(row.id), email: row.email, role: row.role_key ?? null,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at };
}
const ACCOUNT_SELECT = `
  SELECT u.id, u.email, u.is_active, u.created_at, u.updated_at, r.role_key
  FROM iam_users AS u LEFT JOIN iam_roles AS r ON r.id = u.role_id
`;
function validateActor(actorId, actorEmail) {
  if (!validateAccountId(String(actorId)) || !isValidEmail(actorEmail)) throw createError("INVALID_AUDIT_ACTOR", 500);
}

export async function createInternalAccount({ email, password, actorId, actorEmail }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw createError("INVALID_EMAIL", 400);
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw createError("INVALID_PASSWORD", 400);
  validateActor(actorId, actorEmail);
  const passwordHash = await hashPassword(password);

  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO iam_users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email, is_active, created_at, updated_at`,
        [normalizedEmail, passwordHash],
      );
      const account = sanitizeAccount({ ...result.rows[0], role_key: null });
      await recordStrict(client, {
        actorId, actorEmail, action: "account.created", entityType: "account",
        entityId: account.id, before: null,
        after: { email: account.email, role: null, isActive: account.isActive },
      });
      return account;
    });
  } catch (error) {
    if (error.code === "23505") throw createError("ACCOUNT_ALREADY_EXISTS", 409);
    throw error;
  }
}

export async function listInternalAccounts() {
  const result = await pool.query(`${ACCOUNT_SELECT} ORDER BY u.id`);
  return result.rows.map(sanitizeAccount);
}

export async function getInternalAccount(id) {
  if (!validateAccountId(id)) throw createError("INVALID_ACCOUNT_ID", 400);
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE u.id = $1`, [id]);
  if (!result.rows.length) throw createError("ACCOUNT_NOT_FOUND", 404);
  return sanitizeAccount(result.rows[0]);
}

export async function updateInternalAccount({ id, email, actorId, actorEmail }) {
  if (!validateAccountId(id)) throw createError("INVALID_ACCOUNT_ID", 400);
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw createError("INVALID_EMAIL", 400);
  validateActor(actorId, actorEmail);

  try {
    return await withTransaction(async (client) => {
      const current = await client.query(`${ACCOUNT_SELECT} WHERE u.id = $1 FOR UPDATE OF u`, [id]);
      if (!current.rows.length) throw createError("ACCOUNT_NOT_FOUND", 404);
      const before = sanitizeAccount(current.rows[0]);
      if (before.email === normalizedEmail) return before;
      const updated = await client.query(
        `UPDATE iam_users SET email = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING id, email, is_active, created_at, updated_at`,
        [normalizedEmail, id],
      );
      const after = sanitizeAccount({ ...updated.rows[0], role_key: before.role });
      await recordStrict(client, {
        actorId, actorEmail, action: "account.email_updated", entityType: "account",
        entityId: id, before: { email: before.email }, after: { email: after.email },
      });
      return after;
    });
  } catch (error) {
    if (error.code === "23505") throw createError("ACCOUNT_ALREADY_EXISTS", 409);
    throw error;
  }
}

export async function assignInternalRole({ id, roleKey, actorId, actorEmail }) {
  if (!validateAccountId(id)) throw createError("INVALID_ACCOUNT_ID", 400);
  if (String(id) === String(actorId)) throw createError("SELF_ROLE_CHANGE_FORBIDDEN", 403);
  if (typeof roleKey !== "string" || !roleKey.trim()) throw createError("INVALID_ROLE", 400);
  validateActor(actorId, actorEmail);

  return withTransaction(async (client) => {
    const current = await client.query(`${ACCOUNT_SELECT} WHERE u.id = $1 FOR UPDATE OF u`, [id]);
    if (!current.rows.length) throw createError("ACCOUNT_NOT_FOUND", 404);
    const before = sanitizeAccount(current.rows[0]);
    const role = await client.query("SELECT id FROM iam_roles WHERE role_key = $1", [roleKey.trim()]);
    if (!role.rows.length) throw createError("ROLE_NOT_FOUND", 404);
    if (before.role === roleKey.trim()) return before;

    const updated = await client.query(
      `UPDATE iam_users SET role_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id, email, is_active, created_at, updated_at`,
      [role.rows[0].id, id],
    );
    const after = sanitizeAccount({ ...updated.rows[0], role_key: roleKey.trim() });
    await recordStrict(client, {
      actorId, actorEmail, action: "account.role_changed", entityType: "account",
      entityId: id, before: { role: before.role }, after: { role: after.role },
    });
    return after;
  });
}

export async function setInternalAccountActive({ id, isActive, actorId, actorEmail }) {
  if (!validateAccountId(id)) throw createError("INVALID_ACCOUNT_ID", 400);
  if (String(id) === String(actorId) && isActive === false) throw createError("SELF_DEACTIVATION_FORBIDDEN", 403);
  if (typeof isActive !== "boolean") throw createError("INVALID_ACCOUNT_STATUS", 400);
  validateActor(actorId, actorEmail);

  return withTransaction(async (client) => {
    const current = await client.query(`${ACCOUNT_SELECT} WHERE u.id = $1 FOR UPDATE OF u`, [id]);
    if (!current.rows.length) throw createError("ACCOUNT_NOT_FOUND", 404);
    const before = sanitizeAccount(current.rows[0]);
    if (before.isActive === isActive) return before;
    const updated = await client.query(
      `UPDATE iam_users SET is_active = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id, email, is_active, created_at, updated_at`,
      [isActive, id],
    );
    const after = sanitizeAccount({ ...updated.rows[0], role_key: before.role });
    await recordStrict(client, {
      actorId, actorEmail, action: isActive ? "account.activated" : "account.deactivated",
      entityType: "account", entityId: id,
      before: { isActive: before.isActive }, after: { isActive: after.isActive },
    });
    return after;
  });
}
