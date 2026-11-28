import test from "node:test";
import assert from "node:assert/strict";
import { listActiveAccountIdsByRoles } from "./recipients.js";

test("returns ids of active accounts for the given roles as strings", async () => {
  const calls = [];
  const executor = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: 1 }, { id: "4" }] };
    },
  };
  assert.deepEqual(
    await listActiveAccountIdsByRoles(
      ["admin", "transportation_manager"],
      executor,
    ),
    ["1", "4"],
  );
  assert.match(
    calls[0].sql,
    /u\.is_active AND r\.role_key = ANY\(\$1::text\[\]\)/,
  );
  assert.deepEqual(calls[0].values, [["admin", "transportation_manager"]]);
});

test("invalid or empty role lists return nothing without querying", async () => {
  const executor = {
    async query() {
      assert.fail("must not query");
    },
  };
  for (const roles of [undefined, [], "admin", [""], [1], ["admin", " "]]) {
    assert.deepEqual(await listActiveAccountIdsByRoles(roles, executor), []);
  }
});
