import test from "node:test";
import assert from "node:assert/strict";
import { getBusAssignmentEligibility } from "./index.js";
import { parseCreateInput, parseUpdateInput } from "./validation.js";

const bus = { busNumber: "B-1", seatingCapacity: 40, requiredLicenseCategory: "HTV" };

test("bus defaults are optional ids that can be cleared", () => {
  assert.equal("defaultRouteId" in parseCreateInput(bus), false);
  const created = parseCreateInput({ ...bus, defaultRouteId: 5, defaultDriverId: "006" });
  assert.equal(created.defaultRouteId, "5");
  assert.equal(created.defaultDriverId, "6");
  assert.deepEqual(parseUpdateInput({ defaultRouteId: null }), { defaultRouteId: null });
  for (const bad of [0, -1, 1.5, "abc", "", true, {}, "1".repeat(19)]) {
    assert.throws(() => parseUpdateInput({ defaultRouteId: bad }), { code: "INVALID_DEFAULT_ROUTE_ID" });
    assert.throws(() => parseUpdateInput({ defaultDriverId: bad }), { code: "INVALID_DEFAULT_DRIVER_ID" });
  }
});

test("bus eligibility uses the supplied executor", async () => {
  const calls = [];
  const executor = {
    async query(sql, values) {
      calls.push(values);
      return { rows: [{ id: "5", status: "inactive", is_archived: false }] };
    },
  };
  assert.equal((await getBusAssignmentEligibility("5", executor)).reason, "BUS_INACTIVE");
  assert.deepEqual(calls, [["5"]]);
});
