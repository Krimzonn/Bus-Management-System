import test from "node:test";
import assert from "node:assert/strict";

import { requireCapability } from "./authorize.js";

async function runMiddleware(middleware, req) {
  let error = null;
  let nextCalled = false;

  await middleware(req, {}, (nextError) => {
    error = nextError ?? null;
    nextCalled = true;
  });

  return { error, nextCalled };
}

test("rejects requests without an authenticated user", async () => {
  const middleware = requireCapability("view-bus");
  const result = await runMiddleware(middleware, {});

  assert.equal(result.error.status, 401);
  assert.equal(result.error.code, "AUTHENTICATION_REQUIRED");
});

test("rejects users without the required capability", async () => {
  const loader = async () => ({
    Driver: ["view-bus"],
  });

  const middleware = requireCapability("manage-bus", loader);

  const result = await runMiddleware(middleware, {
    user: { id: 1, role: "Driver" },
  });

  assert.equal(result.error.status, 403);
  assert.equal(result.error.code, "INSUFFICIENT_PERMISSION");
});

test("allows users with the required capability", async () => {
  const loader = async () => ({
    Manager: ["view-bus", "manage-bus"],
  });

  const middleware = requireCapability("manage-bus", loader);

  const result = await runMiddleware(middleware, {
    user: { id: 1, role: "Manager" },
  });

  assert.equal(result.error, null);
  assert.equal(result.nextCalled, true);
});

test("rejects users with an unknown role", async () => {
  const loader = async () => ({
    Manager: ["view-bus"],
  });

  const middleware = requireCapability("view-bus", loader);

  const result = await runMiddleware(middleware, {
    user: { id: 1, role: "Unknown" },
  });

  assert.equal(result.error.status, 403);
  assert.equal(result.error.code, "INSUFFICIENT_PERMISSION");
});

test("rejects users when no permission configuration is supplied", async () => {
  const loader = async () => null;

  const middleware = requireCapability("view-bus", loader);

  const result = await runMiddleware(middleware, {
    user: { id: 1, role: "Manager" },
  });

  assert.equal(result.error.status, 403);
  assert.equal(result.error.code, "INSUFFICIENT_PERMISSION");
});

test("passes database errors to the error handler", async () => {
  const loader = async () => {
    throw new Error("Database unavailable");
  };

  const middleware = requireCapability("view-bus", loader);

  const result = await runMiddleware(middleware, {
    user: { id: 1, role: "Manager" },
  });

  assert.equal(result.error.message, "Database unavailable");
});
