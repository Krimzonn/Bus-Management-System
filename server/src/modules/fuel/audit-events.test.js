import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { ACTIONS, ENTITY_TYPES } from "../audit/registry.js";
import { recordStrict } from "../audit/writer.js";

const base = { actorId: "7", actorEmail: "admin@example.com", entityType: "fuel", entityId: "5", before: null };

test("fuel audit actions and entity type are registered", () => {
  assert.ok(ENTITY_TYPES.includes("fuel"));
  for (const action of ["fuel.created", "fuel.updated", "fuel.archived"]) {
    assert.equal(ACTIONS[action]?.entity, "fuel", action);
  }
});

test("fuel audit snapshots accept only registered fields", async (t) => {
  t.mock.method(pool, "connect", async () => ({ async query() { return { rows: [] }; }, release() {} }));
  const run = (event) => withTransaction((tx) => recordStrict(tx, { ...base, ...event }));
  await run({ action: "fuel.updated", after: { liters: "10.00", odometer: 5 } });
  await run({ action: "fuel.archived", after: { isArchived: true } });
  await assert.rejects(run({ action: "fuel.archived", after: { liters: "1.00" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "fuel.updated", after: { busId: "2" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "fuel.updated", entityType: "bus", after: null }), { message: "UNSUPPORTED_AUDIT_ACTION" });
});