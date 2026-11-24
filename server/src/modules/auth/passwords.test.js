import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "./passwords.js";

test("hashes passwords instead of storing plaintext", async () => {
  const password = "StrongPassword123!";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.ok(hash.startsWith("$argon2id$"));
});

test("verifies the correct password", async () => {
  const password = "StrongPassword123!";
  const hash = await hashPassword(password);

  assert.equal(await verifyPassword(hash, password), true);
});

test("rejects an incorrect password", async () => {
  const hash = await hashPassword("StrongPassword123!");

  assert.equal(await verifyPassword(hash, "WrongPassword123!"), false);
});

test("handles an invalid password hash safely", async () => {
  assert.equal(await verifyPassword("invalid-hash", "SomePassword123!"), false);
});
