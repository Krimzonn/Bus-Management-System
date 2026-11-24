import test from "node:test";
import assert from "node:assert/strict";

import { generateCsrfToken, requireCsrf } from "./csrf.js";

test("generates and stores a CSRF token", () => {
  const req = { session: {} };

  const token = generateCsrfToken(req);

  assert.equal(typeof token, "string");
  assert.equal(token.length, 64);
  assert.equal(req.session.csrfToken, token);
});

test("accepts a matching CSRF token", () => {
  const token = "a".repeat(64);
  const req = {
    session: { csrfToken: token },
    get: () => token,
  };

  let nextCalled = false;

  requireCsrf(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("rejects a missing CSRF token", () => {
  const req = {
    session: { csrfToken: "a".repeat(64) },
    get: () => undefined,
  };

  let error;

  requireCsrf(
    req,
    {
      status: () => ({
        json: (data) => {
          error = data;
        },
      }),
    },
    () => {},
  );

  assert.equal(error.code, "CSRF_VALIDATION_FAILED");
});

test("rejects an incorrect CSRF token", () => {
  const req = {
    session: { csrfToken: "a".repeat(64) },
    get: () => "b".repeat(64),
  };

  let error;

  requireCsrf(
    req,
    {
      status: () => ({
        json: (data) => {
          error = data;
        },
      }),
    },
    () => {},
  );

  assert.equal(error.code, "CSRF_VALIDATION_FAILED");
});
