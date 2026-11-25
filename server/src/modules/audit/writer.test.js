import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict, recordBestEffort } from "./writer.js";

const event = {
  actorId: "7", actorEmail: "admin@example.com",
  action: "account.email_updated", entityType: "account", entityId: "19",
  before: { email: "old@example.com" }, after: { email: "new@example.com" },
};

test("strict writer rejects clients not owned by withTransaction", async () => {
  await assert.rejects(recordStrict({ query: async () => ({ rows: [] }) }, event), { message: "AUDIT_TRANSACTION_REQUIRED" });
});

test("strict writer inserts validated data using the active transaction", async (t) => {
  const calls = [];
  const client = {
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  await withTransaction((tx) => recordStrict(tx, event));
  const insert = calls.find((call) => call.sql.includes("INSERT INTO audit_logs"));
  assert.ok(insert);
  assert.equal(insert.values[0], "7");
  assert.equal(insert.values[1], "admin@example.com");
  assert.equal(insert.values[2], "account.email_updated");
});

test("strict writer rejects sensitive or unsupported fields", async (t) => {
  const client = { async query() { return { rows: [] }; }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(
    withTransaction((tx) => recordStrict(tx, { ...event, after: { password: "not logged" } })),
    { message: "INVALID_AUDIT_PAYLOAD" },
  );
});

test("best-effort writer swallows database errors", async (t) => {
  t.mock.method(pool, "query", async () => { throw new Error("database unavailable"); });
  await assert.doesNotReject(recordBestEffort({
    ...event, action: "auth.logout", entityType: "auth",
    before: null, after: { email: "admin@example.com" },
  }));
});
