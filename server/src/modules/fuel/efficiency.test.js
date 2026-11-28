import test from "node:test";
import assert from "node:assert/strict";
import {
  combineEfficiency, estimateFuelEfficiency, formatHundredths, toHundredths,
} from "./efficiency.js";

test("hundredths helpers are exact", () => {
  assert.equal(toHundredths("40.50"), 4050);
  assert.equal(toHundredths("0.07"), 7);
  assert.equal(formatHundredths(4050), "40.50");
  assert.equal(formatHundredths(7), "0.07");
  assert.equal(formatHundredths(0), "0.00");
  assert.equal(formatHundredths(toHundredths("10.10") + toHundredths("20.20")), "30.30");
});

test("efficiency = (last - first odometer) / total liters, rounded to 2 decimals", () => {
  const result = estimateFuelEfficiency([10000, 10400, 10900], 12000);
  assert.deepEqual(result, {
    status: "ok", label: null, reason: null, distance: 900, liters: "120.00", distancePerLiter: 7.5,
  });
  assert.equal(estimateFuelEfficiency([10000, 10400], 7000).distancePerLiter, 5.71);
});

test("the denominator is all liters in the range, including the first record", () => {
  assert.equal(estimateFuelEfficiency([100, 200], 1000).distancePerLiter, 10);
});

test("insufficient data is reported honestly, never fabricated", () => {
  const none = estimateFuelEfficiency([], 0);
  assert.equal(none.status, "insufficient_data");
  assert.equal(none.label, "Insufficient data");
  assert.equal(none.reason, "NO_RECORDS");
  assert.equal(none.distancePerLiter, null);
  assert.equal(estimateFuelEfficiency([500], 4000).reason, "NOT_ENOUGH_RECORDS");
  assert.equal(estimateFuelEfficiency([500, 500], 4000).reason, "ZERO_DISTANCE");
  assert.equal(estimateFuelEfficiency([500, 400], 4000).reason, "INCONSISTENT_ODOMETER");
  assert.equal(estimateFuelEfficiency([500, 900, 800], 4000).reason, "INCONSISTENT_ODOMETER");
  assert.equal(estimateFuelEfficiency([500, 900], 0).status, "insufficient_data"); // never divides by zero
});

test("several buses combine only the buses that have usable data", () => {
  const a = estimateFuelEfficiency([0, 100], 1000);
  const b = estimateFuelEfficiency([0, 300], 2000);
  const c = estimateFuelEfficiency([50], 500);
  const combined = combineEfficiency([a, b, c]);
  assert.equal(combined.status, "ok");
  assert.equal(combined.distance, 400);
  assert.equal(combined.liters, "30.00");
  assert.equal(combined.distancePerLiter, 13.33);
  assert.deepEqual([combined.busesIncluded, combined.busesExcluded], [2, 1]);

  assert.equal(combineEfficiency([c]).reason, "NO_BUS_WITH_SUFFICIENT_DATA");
  assert.equal(combineEfficiency([]).reason, "NO_RECORDS");
});