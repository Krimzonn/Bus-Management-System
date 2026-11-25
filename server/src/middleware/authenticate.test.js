import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../database/db.js";
import { requireAuthentication } from "./authenticate.js";

test("rejects requests without a session user", async () => {
  const req = { session: {} };
  let statusCode;
  let response;
  const res = { status(code) { statusCode = code; return this; }, json(data) { response = data; } };
  await requireAuthentication(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.equal(response.code, "AUTHENTICATION_REQUIRED");
});

test("loads current identity, role and status from the database", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: "1", email: "current@example.com", is_active: true, role_key: "admin" }],
  }));
  const req = { session: { user: { id: 1, email: "stale@example.com", role: "passenger" } } };
  let nextCalled = false;
  await requireAuthentication(req, {}, () => { nextCalled = true; });
  assert.deepEqual(req.user, { id: "1", email: "current@example.com", role: "admin" });
  assert.equal(nextCalled, true);
});

test("destroys sessions for missing or inactive accounts", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  let destroyed = false;
  let statusCode;
  let response;
  const req = { session: { user: { id: 2 }, destroy(callback) { destroyed = true; callback(null); } } };
  const res = { status(code) { statusCode = code; return this; }, json(data) { response = data; } };
  await requireAuthentication(req, res, () => assert.fail("next should not run"));
  assert.equal(destroyed, true);
  assert.equal(statusCode, 401);
  assert.equal(response.code, "ACCOUNT_INACTIVE");
});
