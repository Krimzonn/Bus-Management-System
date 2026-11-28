import test from "node:test";
import assert from "node:assert/strict";
import { listReplacementCandidates } from "./index.js";

const trip = { tripDate: "2027-03-15", requiredLicenseCategory: "HTV" };
const row = (id, overrides = {}) => ({
  id, full_name: `Driver ${id}`, license_category: "HTV", license_expiry_date: "2030-01-01",
  status: "available", is_archived: false, ...overrides,
});
const executorFor = (rows) => ({
  calls: [],
  async query(sql, values) { this.calls.push({ sql, values }); return { rows }; },
});

test("only available drivers with a valid, matching license on the trip date qualify", async () => {
  const executor = executorFor([
    row("3"),
    row("4", { status: "on_leave" }),
    row("5", { status: "absent" }),
    row("6", { license_expiry_date: "2027-03-14" }), // expired the day before
    row("7", { license_category: "LTV" }),
    row("8", { license_expiry_date: "2027-03-15" }), // valid through the trip date
  ]);
  const { candidates, funnel } = await listReplacementCandidates(trip, executor);
  assert.deepEqual(candidates.map((c) => c.id), ["3", "8"]);
  assert.deepEqual(funnel, { evaluated: 6, available: 4, licenseValid: 3, categoryQualified: 2 });
  assert.deepEqual(Object.keys(candidates[0]).sort(),
    ["fullName", "id", "licenseCategory", "licenseExpiryDate"]);
});

test("the query is parameterized, skips archived drivers and excludes the current driver", async () => {
  const executor = executorFor([]);
  await listReplacementCandidates({ ...trip, excludeDriverId: "2" }, executor);
  await listReplacementCandidates(trip, executor);
  assert.match(executor.calls[0].sql, /is_archived = FALSE/);
  assert.deepEqual(executor.calls[0].values, ["2"]);
  assert.deepEqual(executor.calls[1].values, [null]);
});

test("the current date does not matter, only the trip date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2031-01-01T00:00:00Z") });
  const { candidates } = await listReplacementCandidates(trip, executorFor([row("3")]));
  assert.equal(candidates.length, 1);
});

test("no drivers gives an empty, explainable result; bad input is an error", async () => {
  const { candidates, funnel } = await listReplacementCandidates(trip, executorFor([]));
  assert.deepEqual(candidates, []);
  assert.deepEqual(funnel, { evaluated: 0, available: 0, licenseValid: 0, categoryQualified: 0 });
  await assert.rejects(listReplacementCandidates({ ...trip, tripDate: "2027-02-30" }, executorFor([])),
    { code: "INVALID_TRIP_DATE" });
  await assert.rejects(listReplacementCandidates({ ...trip, requiredLicenseCategory: "" }, executorFor([])),
    { code: "INVALID_LICENSE_CATEGORY" });
  await assert.rejects(listReplacementCandidates({ ...trip, excludeDriverId: "abc" }, executorFor([])),
    { code: "INVALID_DRIVER_ID" });
});