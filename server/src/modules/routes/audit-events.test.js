import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { ACTIONS, ENTITY_TYPES } from "../audit/registry.js";
import { recordStrict } from "../audit/writer.js";

const base = { actorId: "7", actorEmail: "admin@example.com", entityType: "route", entityId: "5" };

const events = {
  "route.created": { before: null, after: { routeCode: "R-1", name: "A", origin: "B", destination: "C", status: "unblocked", isArchived: false } },
  "route.updated": { before: { name: "A" }, after: { name: "B" } },
  "route.status_changed": { before: { status: "unblocked" }, after: { status: "blocked" } },
  "route.archived": { before: { isArchived: false }, after: { isArchived: true } },
};

function mockClient(t) {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  return calls;
}

test("route audit actions and entity type are registered", () => {
  assert.ok(ENTITY_TYPES.includes("route"));
  for (const action of Object.keys(events)) {
    assert.ok(Object.hasOwn(ACTIONS, action), `${action} missing from registry`);
    assert.equal(ACTIONS[action].entity, "route");
  }
});

for (const [action, snapshots] of Object.entries(events)) {
  test(`recordStrict writes ${action}`, async (t) => {
    const calls = mockClient(t);
    await withTransaction((tx) => recordStrict(tx, { ...base, action, ...snapshots }));
    const insert = calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
    assert.ok(insert);
    assert.equal(insert.values[2], action);
    assert.equal(insert.values[3], "route");
  });
}

test("route audit snapshots reject unknown fields, arrays and objects", async (t) => {
  mockClient(t);
  const run = (event) => withTransaction((tx) => recordStrict(tx, { ...base, ...event }));
  await assert.rejects(run({ action: "route.updated", before: null, after: { secret: "x" } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "route.updated", before: null, after: { name: ["a"] } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "route.updated", before: null, after: { name: { a: 1 } } }), { message: "INVALID_AUDIT_PAYLOAD" });
  await assert.rejects(run({ action: "route.status_changed", before: null, after: { name: "A" } }), { message: "INVALID_AUDIT_PAYLOAD" });
});

test("route actions cannot be recorded under another entity type", async (t) => {
  mockClient(t);
  await assert.rejects(
    withTransaction((tx) => recordStrict(tx, { ...base, entityType: "bus", action: "route.archived", before: null, after: null })),
    { message: "UNSUPPORTED_AUDIT_ACTION" },
  );
});