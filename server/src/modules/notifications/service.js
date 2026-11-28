import { pool } from "../../database/db.js";
import { renderNotification } from "./templates.js";
import {
  notificationError,
  parseListFilters,
  parseNotificationId,
  parseRecipientId,
} from "./validation.js";

const TABLE = "notifications_notifications";
const COLUMNS =
  "id, recipient_id, event_type, title, message, entity_type, entity_id, read_at, created_at";

// recipient_id is deliberately not returned: callers only ever see their own rows.
function toNotification(row) {
  return {
    id: String(row.id),
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    entityType: row.entity_type ?? null,
    entityId: row.entity_id ?? null,
    isRead: row.read_at != null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

export async function listNotifications(userId, query) {
  const recipientId = parseRecipientId(userId);
  const filters = parseListFilters(query);
  const values = [recipientId];
  const clauses = ["recipient_id = $1"];
  if (filters.unread) clauses.push("read_at IS NULL");
  values.push(filters.limit, (filters.page - 1) * filters.limit);

  const result = await pool.query(
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     FROM ${TABLE}
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    values,
  );
  return {
    items: result.rows.map(toNotification),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function countUnreadNotifications(userId) {
  const recipientId = parseRecipientId(userId);
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${TABLE} WHERE recipient_id = $1 AND read_at IS NULL`,
    [recipientId],
  );
  return { count: Number(result.rows[0]?.count ?? 0) };
}

// Idempotent: the first read time is kept. A notification that belongs to someone
// else is reported exactly like one that does not exist.
export async function markNotificationRead(userId, id) {
  const recipientId = parseRecipientId(userId);
  const notificationId = parseNotificationId(id);
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE id = $1 AND recipient_id = $2
     RETURNING ${COLUMNS}`,
    [notificationId, recipientId],
  );
  if (!result.rows.length)
    throw notificationError("NOTIFICATION_NOT_FOUND", 404);
  return toNotification(result.rows[0]);
}

// ---- creation (internal; there is no HTTP endpoint that creates notifications) ----

const INSERT = `INSERT INTO ${TABLE}
    (recipient_id, event_type, title, message, entity_type, entity_id, dedupe_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id`;

function toId(value) {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text) || BigInt(text) < 1n)
    return null;
  return String(BigInt(text));
}

// entry: { recipientId, eventType, data, entityId?, dedupeKey? }
function prepare(entry) {
  const recipientId = toId(entry?.recipientId);
  if (recipientId === null) throw new Error("INVALID_NOTIFICATION_RECIPIENT");
  const rendered = renderNotification(entry.eventType, entry.data);
  if (!rendered) throw new Error("UNSUPPORTED_NOTIFICATION_EVENT");

  const entityId = entry.entityId == null ? null : String(entry.entityId);
  if (entityId !== null && (entityId.length < 1 || entityId.length > 40)) {
    throw new Error("INVALID_NOTIFICATION_ENTITY");
  }
  const dedupeKey = entry.dedupeKey == null ? null : String(entry.dedupeKey);
  if (dedupeKey !== null && (dedupeKey.length < 1 || dedupeKey.length > 200)) {
    throw new Error("INVALID_NOTIFICATION_DEDUPE_KEY");
  }
  return [
    recipientId,
    entry.eventType,
    rendered.title,
    rendered.message,
    entityId === null ? null : rendered.entityType,
    entityId,
    dedupeKey,
  ];
}

// Best effort (ADR-005): never throws, runs on the pool and never on a business
// transaction, so a failure here can never undo a business action. Each entry is
// independent, so one bad entry does not stop the others. Only the error message
// is logged (no notification content).
export async function createNotificationsBestEffort(entries, executor = pool) {
  const summary = { created: 0, duplicates: 0, failed: 0 };
  for (const entry of Array.isArray(entries) ? entries : []) {
    try {
      const result = await executor.query(INSERT, prepare(entry));
      if (result.rows.length) summary.created += 1;
      else summary.duplicates += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn("Notification could not be created:", error?.message);
    }
  }
  return summary;
}
