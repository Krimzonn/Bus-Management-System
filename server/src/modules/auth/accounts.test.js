import test from "node:test";
import assert from "node:assert/strict";

test("rejects an invalid email", async () => {
  const { createInternalAccount } = await import("./accounts.js");

  await assert.rejects(
    createInternalAccount({
      email: "",
      password: "StrongPassword123!",
    }),
    { code: "INVALID_EMAIL" },
  );
});

test("rejects passwords shorter than 12 characters", async () => {
  const { createInternalAccount } = await import("./accounts.js");

  await assert.rejects(
    createInternalAccount({
      email: "test@example.com",
      password: "short",
    }),
    { code: "INVALID_PASSWORD" },
  );
});
