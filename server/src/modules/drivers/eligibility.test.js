import test from "node:test";
import assert from "node:assert/strict";
// Exercised only through the public module interface, without HTTP.
import { evaluateDriverEligibility, getDriverAssignmentEligibility } from "./index.js";

const driver = (overrides = {}) => ({
  id: "5", status: "available", isArchived: false, licenseCategory: "HTV",
  licenseExpiryDate: "2026-12-15", ...overrides,
});
const trip = { tripDate: "2026-12-10", requiredLicenseCategory: "HTV" };
const eligible = { eligible: true, reason: null };
const refused = (reason) => ({ eligible: false, reason });

test("available, unarchived driver with a valid matching license is eligible", () => {
  assert.deepEqual(evaluateDriverEligibility(driver(), trip), eligible);
});

for (const [name, overrides, reason] of [
  ["on leave", { status: "on_leave" }, "DRIVER_ON_LEAVE"],
  ["absent", { status: "absent" }, "DRIVER_ABSENT"],
  ["unknown status", { status: "x" }, "DRIVER_UNAVAILABLE"],
  ["archived", { isArchived: true }, "DRIVER_ARCHIVED"],
  ["unknown archive state", { isArchived: undefined }, "DRIVER_ARCHIVED"],
  ["expired license", { licenseExpiryDate: "2025-01-01" }, "LICENSE_EXPIRED"],
  ["missing expiry date", { licenseExpiryDate: undefined }, "LICENSE_EXPIRED"],
  ["category mismatch", { licenseCategory: "LTV" }, "LICENSE_CATEGORY_MISMATCH"],
]) {
  test(`ineligible: ${name}`, () => {
    assert.deepEqual(evaluateDriverEligibility(driver(overrides), trip), refused(reason));
  });
}

test("license validity is judged on the trip date", () => {
  const on = (tripDate) => evaluateDriverEligibility(driver(), { ...trip, tripDate });
  assert.deepEqual(on("2026-12-14"), eligible); // expires after the trip
  assert.deepEqual(on("2026-12-15"), eligible); // expires on the trip date
  assert.deepEqual(on("2026-12-16"), refused("LICENSE_EXPIRED")); // expired the day before
});

test("the current date does not affect eligibility", (t) => {
  for (const now of ["2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z"]) {
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ["Date"], now: new Date(now) });
    assert.deepEqual(evaluateDriverEligibility(driver(), trip), eligible);
    assert.deepEqual(
      evaluateDriverEligibility(driver(), { ...trip, tripDate: "2026-12-16" }),
      refused("LICENSE_EXPIRED"),
    );
  }
});

test("required category is normalized like Fleet categories", () => {
  assert.deepEqual(evaluateDriverEligibility(driver(), { ...trip, requiredLicenseCategory: " htv " }), eligible);
});

test("missing driver is ineligible", () => {
  assert.deepEqual(evaluateDriverEligibility(null, trip), refused("DRIVER_NOT_FOUND"));
});

test("missing or invalid requirements are errors, never eligibility", () => {
  assert.throws(() => evaluateDriverEligibility(driver()), { code: "INVALID_TRIP_DATE" });
  assert.throws(() => evaluateDriverEligibility(driver(), { ...trip, tripDate: "2026-02-30" }), { code: "INVALID_TRIP_DATE" });
  assert.throws(() => evaluateDriverEligibility(driver(), { tripDate: trip.tripDate }), { code: "INVALID_LICENSE_CATEGORY" });
});

const executorFor = (rows) => ({
  calls: [],
  async query(sql, values) { this.calls.push({ sql, values }); return { rows }; },
});

test("lookup uses the caller's executor and returns no driver data", async () => {
  const executor = executorFor([{
    id: "5", full_name: "Ali", license_number: "L-1", license_category: "HTV",
    license_expiry_date: "2026-12-15", status: "available", is_archived: false,
  }]);
  const result = await getDriverAssignmentEligibility("5", trip, executor);
  assert.deepEqual(result, eligible);
  assert.deepEqual(executor.calls[0].values, ["5"]);
  assert.match(executor.calls[0].sql, /^SELECT/);
});

test("lookup reports a nonexistent driver and rejects a malformed id", async () => {
  assert.deepEqual(await getDriverAssignmentEligibility("99", trip, executorFor([])), refused("DRIVER_NOT_FOUND"));
  await assert.rejects(getDriverAssignmentEligibility("abc", trip, executorFor([])), { code: "INVALID_DRIVER_ID" });
});
