import test from "node:test";
import assert from "node:assert/strict";

import { isCapabilityAllowed } from "./policy.js";

const roleCapabilities = {
  "Test Role": ["view-bus", "manage-bus"],
  "Another Test Role": ["view-bus"],
};

test("allows a capability assigned to the user's role", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Test Role",
      capability: "manage-bus",
      roleCapabilities,
    }),
    true,
  );
});

test("denies a capability not assigned to the user's role", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Another Test Role",
      capability: "manage-bus",
      roleCapabilities,
    }),
    false,
  );
});

test("denies an unknown role", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Unknown Role",
      capability: "view-bus",
      roleCapabilities,
    }),
    false,
  );
});

test("denies a missing role", () => {
  assert.equal(
    isCapabilityAllowed({
      capability: "view-bus",
      roleCapabilities,
    }),
    false,
  );
});

test("denies a missing capability", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Test Role",
      roleCapabilities,
    }),
    false,
  );
});

test("denies invalid role-capability configuration", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Test Role",
      capability: "view-bus",
      roleCapabilities: {
        "Test Role": "view-bus",
      },
    }),
    false,
  );
});

test("does not grant permissions to an empty configuration", () => {
  assert.equal(
    isCapabilityAllowed({
      role: "Test Role",
      capability: "view-bus",
      roleCapabilities: {},
    }),
    false,
  );
});
