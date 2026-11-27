import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { ACTIONS, ENTITY_TYPES } from "../audit/registry.js";
import { recordStrict } from "../audit/writer.js";

const base = { actorId: "7", actorEmail: "admin@example.com", entityType: "driver", entityId: "5", before: null };

test("driver audit actions and entity type are registered", () => {
  assert.ok(ENTITY_TYPES.includes("driver"));
  for (const action of [
    "driver.created", "driver.updated", "driver.license_updated", "driver.status_changed", "driver.archived",
  ]) {
    assert.equal(ACTIONS[action]?.entity, "driver", action);
  }
});

test("driver audit snapshots accept only registered fields", async (t) => {
  t.mock.method(pool, "connect", async () => ({ async query() { return { rows: [] }; }, release() {} }));
  const run = (event) => withTransaction((tx) => recordStrict(tx, { ...base, ...event }));
  await run({ action: "driver.license_updated", after: { licenseNumber: "A-1" } });
  await assert.rejects(run({ action: "driver.updated", after: { licenseNumber: "A-1" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "driver.created", after: { phone: "1" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "driver.archived", entityType: "bus", after: null }), { message: "UNSUPPORTED_AUDIT_ACTION" });
});
