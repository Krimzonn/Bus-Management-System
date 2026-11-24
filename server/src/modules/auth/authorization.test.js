import test from "node:test";
import assert from "node:assert/strict";

import { hasCapability } from "./authorization.js";

const roleCapabilities = {
  Admin: ["manage-bus", "view-reports"],
  Driver: ["view-own-schedule"],
};

test("allows a capability explicitly assigned to a role", () => {
  assert.equal(hasCapability("Admin", "manage-bus", roleCapabilities), true);
});

test("denies a capability not assigned to a role", () => {
  assert.equal(hasCapability("Driver", "manage-bus", roleCapabilities), false);
});

test("denies unknown roles", () => {
  assert.equal(hasCapability("Unknown", "manage-bus", roleCapabilities), false);
});

test("denies unknown capabilities", () => {
  assert.equal(
    hasCapability("Admin", "delete-everything", roleCapabilities),
    false,
  );
});

test("denies invalid policy configuration", () => {
  assert.equal(hasCapability("Admin", "manage-bus", null), false);
  assert.equal(hasCapability("Admin", "manage-bus", []), false);
});
