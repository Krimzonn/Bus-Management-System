import { pool } from "../../database/db.js";
import { isActiveTransaction } from "../../database/transaction.js";
import { ACTIONS } from "./registry.js";

const MAX_JSON_BYTES = 4096;

function validateSnapshot(action, snapshot) {
  if (snapshot == null) return null;
  if (typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("INVALID_AUDIT_PAYLOAD");
  const allowed = ACTIONS[action].fields;
  for (const [key, value] of Object.entries(snapshot)) {
    if (!allowed.includes(key)) throw new Error("INVALID_AUDIT_PAYLOAD");
    if (value !== null && typeof value !== "string" && typeof value !== "boolean") throw new Error("INVALID_AUDIT_PAYLOAD");
    if (typeof value === "string" && value.length > 255) throw new Error("INVALID_AUDIT_PAYLOAD");
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_JSON_BYTES) throw new Error("INVALID_AUDIT_PAYLOAD");
  return snapshot;
}

function validateEvent(event) {
  const definition = ACTIONS[event?.action];
  if (!definition || definition.entity !== event.entityType) throw new Error("UNSUPPORTED_AUDIT_ACTION");
  if (
    event.actorId == null ||
    !/^\d+$/.test(String(event.actorId)) ||
    typeof event.actorEmail !== "string" ||
    event.actorEmail.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.actorEmail)
  ) throw new Error("INVALID_AUDIT_ACTOR");
  if (event.entityId != null && String(event.entityId).length > 255) throw new Error("INVALID_AUDIT_ENTITY");

  return {
    actorId: String(event.actorId),
    actorEmail: event.actorEmail,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId == null ? null : String(event.entityId),
    before: validateSnapshot(event.action, event.before),
    after: validateSnapshot(event.action, event.after),
  };
}

async function insert(client, event) {
  const safe = validateEvent(event);
  await client.query(
    `INSERT INTO audit_logs
      (actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [safe.actorId, safe.actorEmail, safe.action, safe.entityType, safe.entityId,
      safe.before === null ? null : JSON.stringify(safe.before),
      safe.after === null ? null : JSON.stringify(safe.after)],
  );
}

export async function recordStrict(client, event) {
  if (!isActiveTransaction(client)) throw new Error("AUDIT_TRANSACTION_REQUIRED");
  return insert(client, event);
}

// Actor identity/email is resolved by Identity & Access, never by this module.
export async function recordBestEffort(event) {
  try {
    await insert(pool, event);
  } catch (error) {
    console.warn("Best-effort audit recording failed:", error.message);
  }
}
