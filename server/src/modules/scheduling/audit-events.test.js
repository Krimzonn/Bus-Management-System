import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { ACTIONS, ENTITY_TYPES } from "../audit/registry.js";
import { recordStrict } from "../audit/writer.js";

const base = {
  actorId: "7", actorEmail: "admin@example.com", entityType: "schedule", entityId: "5", before: null,
};

test("schedule audit actions and entity type are registered", () => {
  assert.ok(ENTITY_TYPES.includes("schedule"));
  for (const action of [
    "schedule.created", "schedule.updated", "schedule.assignment_changed",
    "schedule.started", "schedule.completed", "schedule.cancelled",
  ]) {
    assert.equal(ACTIONS[action]?.entity, "schedule", action);
  }
});

test("schedule audit snapshots accept only registered fields", async (t) => {
  t.mock.method(pool, "connect", async () => ({ async query() { return { rows: [] }; }, release() {} }));
  const run = (event) => withTransaction((tx) => recordStrict(tx, { ...base, ...event }));
  await run({ action: "schedule.assignment_changed", after: { driverId: "4" } });
  await assert.rejects(run({ action: "schedule.updated", after: { driverId: "4" } }),
    { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "schedule.started", after: { driverName: "x" } }),
    { message: "INVALID_AUDIT_PAYLOAD" });
});
