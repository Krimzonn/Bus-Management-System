import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { withTransaction, isActiveTransaction } from "./transaction.js";

function fakeClient(options = {}) {
  const calls = [];
  let releaseError;
  let released = false;
  return {
    calls,
    get released() { return released; },
    get releaseError() { return releaseError; },
    async query(sql) {
      calls.push(sql);
      if (sql === "BEGIN" && options.begin) throw new Error("begin failed");
      if (sql === "COMMIT" && options.commit) throw new Error("commit failed");
      if (sql === "ROLLBACK" && options.rollback) throw new Error("rollback failed");
      return { rows: [] };
    },
    release(error) { released = true; releaseError = error; },
  };
}

test("commits and releases once", async (t) => {
  const client = fakeClient();
  t.mock.method(pool, "connect", async () => client);
  const result = await withTransaction(async (tx) => {
    assert.equal(isActiveTransaction(tx), true);
    return "ok";
  });
  assert.equal(result, "ok");
  assert.deepEqual(client.calls, ["BEGIN", "COMMIT"]);
  assert.equal(client.released, true);
  assert.equal(isActiveTransaction(client), false);
});

test("discards the client when BEGIN fails", async (t) => {
  const client = fakeClient({ begin: true });
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(withTransaction(async () => {}), /begin failed/);
  assert.equal(client.released, true);
  assert.match(client.releaseError.message, /begin failed/);
});

test("rolls back operation failures and preserves the original error", async (t) => {
  const client = fakeClient();
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(withTransaction(async () => { throw new Error("operation failed"); }), /operation failed/);
  assert.deepEqual(client.calls, ["BEGIN", "ROLLBACK"]);
  assert.equal(client.released, true);
});

test("discards a client when rollback fails", async (t) => {
  const client = fakeClient({ rollback: true });
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(withTransaction(async () => { throw new Error("original failure"); }), /original failure/);
  assert.match(client.releaseError.message, /rollback failed/);
});

test("attempts rollback when COMMIT fails", async (t) => {
  const client = fakeClient({ commit: true });
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(withTransaction(async () => {}), /commit failed/);
  assert.deepEqual(client.calls, ["BEGIN", "COMMIT", "ROLLBACK"]);
});
