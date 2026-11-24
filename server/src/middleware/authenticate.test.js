import test from "node:test";
import assert from "node:assert/strict";

import { pool } from "../database/db.js";
import { requireAuthentication } from "./authenticate.js";

test("rejects requests without a session user", async () => {
  const req = { session: {} };
  let statusCode;
  let response;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      response = data;
    },
  };

  await requireAuthentication(req, res, () => {});

  assert.equal(statusCode, 401);
  assert.equal(response.code, "AUTHENTICATION_REQUIRED");
});

test("populates req.user from an active authenticated session", async (t) => {
  const user = {
    id: 1,
    email: "test@example.com",
    role: null,
  };

  t.mock.method(pool, "query", async () => ({
    rows: [{ is_active: true }],
  }));

  const req = { session: { user } };
  let nextCalled = false;

  await requireAuthentication(req, {}, () => {
    nextCalled = true;
  });

  assert.deepEqual(req.user, user);
  assert.equal(nextCalled, true);
});

test("rejects inactive accounts and destroys their sessions", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ is_active: false }],
  }));

  let sessionDestroyed = false;
  let statusCode;
  let response;

  const req = {
    session: {
      user: {
        id: 2,
        email: "inactive@example.com",
        role: "administrative_staff",
      },
      destroy(callback) {
        sessionDestroyed = true;
        callback(null);
      },
    },
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      response = data;
    },
  };

  await requireAuthentication(req, res, () => {
    assert.fail("next() should not be called for an inactive account");
  });

  assert.equal(sessionDestroyed, true);
  assert.equal(statusCode, 401);
  assert.equal(response.code, "ACCOUNT_INACTIVE");
});
