import test from "node:test";
import assert from "node:assert/strict";

import { buildRoleCapabilities } from "./permissions.js";

test("groups capabilities under their respective roles", () => {
  const rows = [
    { role_key: "Role A", capability_key: "view-bus" },
    { role_key: "Role A", capability_key: "manage-bus" },
    { role_key: "Role B", capability_key: "view-bus" },
  ];

  const result = buildRoleCapabilities(rows);

  assert.deepEqual(result["Role A"], ["view-bus", "manage-bus"]);
  assert.deepEqual(result["Role B"], ["view-bus"]);
});

test("returns an empty mapping when there are no assignments", () => {
  assert.deepEqual(buildRoleCapabilities([]), {});
});

test("ignores invalid database rows", () => {
  const rows = [
    { role_key: "Role A", capability_key: "view-bus" },
    { role_key: null, capability_key: "manage-bus" },
    { role_key: "Role B", capability_key: null },
  ];

  const result = buildRoleCapabilities(rows);

  assert.deepEqual(result["Role A"], ["view-bus"]);
  assert.equal(Object.keys(result).length, 1);
});

test("does not duplicate repeated capabilities", () => {
  const rows = [
    { role_key: "Role A", capability_key: "view-bus" },
    { role_key: "Role A", capability_key: "view-bus" },
  ];

  const result = buildRoleCapabilities(rows);

  assert.deepEqual(result["Role A"], ["view-bus"]);
});
