import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { ACTIONS, ENTITY_TYPES } from "../audit/registry.js";
import { recordStrict } from "../audit/writer.js";

const base = {
  actorId: "7", actorEmail: "admin@example.com", entityType: "maintenance", entityId: "5", before: null,
};

test("maintenance audit actions and entity type are registered", () => {
  assert.ok(ENTITY_TYPES.includes("maintenance"));
  for (const action of ["maintenance.created", "maintenance.updated", "maintenance.archived"]) {
    assert.equal(ACTIONS[action]?.entity, "maintenance", action);
  }
});

test("maintenance audit snapshots accept only registered fields and short strings", async (t) => {
  t.mock.method(pool, "connect", async () => ({ async query() { return { rows: [] }; }, release() {} }));
  const run = (event) => withTransaction((tx) => recordStrict(tx, { ...base, ...event }));
  await run({ action: "maintenance.updated", after: { cost: "10.00", odometer: null } });
  await run({ action: "maintenance.archived", after: { isArchived: true } });
  await assert.rejects(run({ action: "maintenance.archived", after: { cost: "1.00" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "maintenance.updated", after: { busId: "2" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "maintenance.updated", after: { workDescription: "x".repeat(256) } }),
    { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "maintenance.updated", entityType: "bus", after: null }), { message: "UNSUPPORTED_AUDIT_ACTION" });
});