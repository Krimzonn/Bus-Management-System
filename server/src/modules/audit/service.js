import { pool } from "../../database/db.js";
import { ACTIONS, ENTITY_TYPES } from "./registry.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;

function invalidFilter() {
  return Object.assign(new Error("INVALID_AUDIT_FILTER"), { status: 400, code: "INVALID_AUDIT_FILTER" });
}
function invalidPagination() {
  return Object.assign(new Error("INVALID_PAGINATION"), { status: 400, code: "INVALID_PAGINATION" });
}
function parseTimestamp(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(Date.parse(value))) throw invalidFilter();
  return new Date(value).toISOString();
}
function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) throw invalidPagination();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw invalidPagination();
  return n;
}

export async function listAudit(filters = {}) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw invalidFilter();
  const clauses = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.actorId !== undefined) {
    if (typeof filters.actorId !== "string" || !/^\d+$/.test(filters.actorId)) throw invalidFilter();
    add("actor_id = ?", filters.actorId);
  }
  if (filters.action !== undefined) {
    if (typeof filters.action !== "string" || !Object.hasOwn(ACTIONS, filters.action)) throw invalidFilter();
    add("action = ?", filters.action);
  }
  if (filters.entityType !== undefined) {
    if (typeof filters.entityType !== "string" || !ENTITY_TYPES.includes(filters.entityType)) throw invalidFilter();
    add("entity_type = ?", filters.entityType);
  }
  if (filters.entityId !== undefined) {
    if (typeof filters.entityId !== "string" || filters.entityId.length > 255) throw invalidFilter();
    add("entity_id = ?", filters.entityId);
  }

  const from = filters.from === undefined ? null : parseTimestamp(filters.from);
  const to = filters.to === undefined ? null : parseTimestamp(filters.to);
  if (from && to && Date.parse(from) >= Date.parse(to)) throw invalidFilter();
  if (from) add("created_at >= ?", from);
  if (to) add("created_at < ?", to);

  const page = parsePositiveInteger(filters.page, 1, MAX_PAGE);
  const limit = parsePositiveInteger(filters.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(limit, (page - 1) * limit);

  const result = await pool.query(
    `SELECT id, actor_id, actor_email, action, entity_type, entity_id,
            before_data, after_data, created_at
     FROM audit_logs ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: result.rows, page, limit };
}
