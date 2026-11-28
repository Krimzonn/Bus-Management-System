import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCost, parseCreateInput, parseDueFilters, parseHistoryFilters, parseListFilters,
  parseMaintenanceId, parseNextServiceDate, parseOdometer, parseServiceDate, parseUpdateInput,
} from "./maintenance-validation.js";

const valid = {
  busId: "1", serviceDate: "2026-11-01", maintenanceType: "  Oil   change ",
  workDescription: "Changed oil and filter", cost: 150, odometer: 12000, nextServiceDate: "2027-02-01",
};
const rejects = (fn, code) => assert.throws(fn, { code, status: 400 });

test("create input normalizes text, formats cost and keeps optional fields optional", () => {
  assert.deepEqual(parseCreateInput(valid), {
    busId: "1", serviceDate: "2026-11-01", maintenanceType: "Oil change",
    workDescription: "Changed oil and filter", cost: "150.00", odometer: 12000,
    nextServiceDate: "2027-02-01",
  });
  const minimal = parseCreateInput({ ...valid, odometer: undefined, nextServiceDate: undefined });
  assert.equal(minimal.odometer, null);
  assert.equal(minimal.nextServiceDate, null);
  assert.equal(parseCreateInput({ ...valid, busId: 7 }).busId, "7");
});

test("bus id must be a valid positive id", () => {
  for (const busId of [undefined, null, "0", "-1", "abc", "", 1.5, "1".repeat(19)]) {
    rejects(() => parseCreateInput({ ...valid, busId }), "INVALID_BUS_ID");
  }
});

test("service and next service dates are real calendar dates in range", () => {
  assert.equal(parseServiceDate("1900-01-01"), "1900-01-01");
  assert.equal(parseServiceDate("2028-02-29"), "2028-02-29");
  for (const value of [
    "1899-12-31", "9999-12-31", "2027-02-30", "2027-13-01", "2027-1-5",
    "2027-12-31T00:00:00Z", "", null, undefined, 20271231,
  ]) rejects(() => parseServiceDate(value), "INVALID_SERVICE_DATE");
  assert.equal(parseNextServiceDate(undefined), null);
  assert.equal(parseNextServiceDate(null), null);
  rejects(() => parseNextServiceDate("2027-02-30"), "INVALID_NEXT_SERVICE_DATE");
});

test("next service date may equal but never precede the service date", () => {
  assert.equal(parseCreateInput({ ...valid, nextServiceDate: valid.serviceDate }).nextServiceDate, valid.serviceDate);
  rejects(() => parseCreateInput({ ...valid, nextServiceDate: "2026-10-31" }), "NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE");
  rejects(() => parseUpdateInput({ serviceDate: "2026-11-05", nextServiceDate: "2026-11-04" }),
    "NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE");
});

test("type and description reject empty, oversized and control-character text", () => {
  for (const value of [undefined, null, "", "   ", 5, "a\u0000b", "a\nb"]) {
    rejects(() => parseCreateInput({ ...valid, maintenanceType: value }), "INVALID_MAINTENANCE_TYPE");
    rejects(() => parseCreateInput({ ...valid, workDescription: value }), "INVALID_WORK_DESCRIPTION");
  }
  assert.equal(parseCreateInput({ ...valid, maintenanceType: "x".repeat(100) }).maintenanceType.length, 100);
  rejects(() => parseCreateInput({ ...valid, maintenanceType: "x".repeat(101) }), "INVALID_MAINTENANCE_TYPE");
  assert.equal(parseCreateInput({ ...valid, workDescription: "x".repeat(255) }).workDescription.length, 255);
  rejects(() => parseCreateInput({ ...valid, workDescription: "x".repeat(256) }), "INVALID_WORK_DESCRIPTION");
});

test("cost boundaries and precision", () => {
  assert.equal(parseCost(0), "0.00");
  assert.equal(parseCost("0"), "0.00");
  assert.equal(parseCost("150.5"), "150.50");
  assert.equal(parseCost(150.25), "150.25");
  assert.equal(parseCost(" 12.30 "), "12.30");
  assert.equal(parseCost(9999999999.99), "9999999999.99");
  for (const value of [
    -1, "-0.01", "10000000000", "9999999999.995", "1.234", "abc", "", "1e3", ".5", "5.",
    NaN, Infinity, -Infinity, null, undefined, true, {}, 0.1 + 0.2,
  ]) rejects(() => parseCost(value), "INVALID_COST");
});

test("odometer is optional; when given it is a whole number from 0 to 9,999,999", () => {
  assert.equal(parseOdometer(undefined), null);
  assert.equal(parseOdometer(null), null);
  assert.equal(parseOdometer(0), 0);
  assert.equal(parseOdometer(9999999), 9999999);
  for (const value of [-1, 10000000, 1.5, "100", NaN, Infinity, true]) {
    rejects(() => parseOdometer(value), "INVALID_ODOMETER");
  }
});

test("create input rejects unknown fields and non-objects", () => {
  for (const body of [null, undefined, [], "x", { ...valid, isArchived: true }, { ...valid, createdBy: "1" }]) {
    rejects(() => parseCreateInput(body), "INVALID_INPUT");
  }
});

test("update input is partial, non-empty, cannot change the bus, and can clear optional fields", () => {
  assert.deepEqual(parseUpdateInput({ cost: "20" }), { cost: "20.00" });
  assert.deepEqual(parseUpdateInput({ odometer: null, nextServiceDate: null }), { odometer: null, nextServiceDate: null });
  for (const body of [{}, { busId: "2" }, { archivedAt: "x" }]) rejects(() => parseUpdateInput(body), "INVALID_INPUT");
  rejects(() => parseUpdateInput({ cost: null }), "INVALID_COST");
  rejects(() => parseUpdateInput({ serviceDate: null }), "INVALID_SERVICE_DATE");
});

test("maintenance id validation", () => {
  assert.equal(parseMaintenanceId("12"), "12");
  for (const id of ["0", "-1", "1.5", "abc", "", 3, undefined, "1".repeat(19)]) {
    rejects(() => parseMaintenanceId(id), "INVALID_MAINTENANCE_ID");
  }
});

test("list filters apply defaults and reject bad values", () => {
  assert.deepEqual(parseListFilters({}), { archived: "false", page: 1, limit: 25 });
  assert.equal(parseListFilters({ archived: "all" }).archived, "all");
  assert.deepEqual(
    parseListFilters({ busId: "3", serviceFrom: "2026-01-01", serviceTo: "2026-01-01", q: " oil ", page: "2", limit: "10" }),
    { archived: "false", busId: "3", serviceFrom: "2026-01-01", serviceTo: "2026-01-01", q: "oil", page: 2, limit: 10 },
  );
  for (const query of [
    { archived: "maybe" }, { busId: "x" }, { busId: ["1", "2"] }, { q: ["a"] }, { q: "x".repeat(101) },
    { q: "a\u0000" }, { serviceFrom: "2026-02-30" }, { serviceFrom: "2026-02-01", serviceTo: "2026-01-01" },
    { status: "x" }, { due: "overdue" },
  ]) rejects(() => parseListFilters(query), "INVALID_MAINTENANCE_FILTER");
  rejects(() => parseListFilters({ page: "0" }), "INVALID_PAGINATION");
  rejects(() => parseListFilters({ limit: "101" }), "INVALID_PAGINATION");
  rejects(() => parseListFilters({ page: "1.5" }), "INVALID_PAGINATION");
});

test("history includes archived records by default; due filters take no archive option", () => {
  assert.equal(parseHistoryFilters({}).archived, "all");
  assert.equal(parseHistoryFilters({ archived: "false" }).archived, "false");
  rejects(() => parseHistoryFilters({ busId: "1" }), "INVALID_MAINTENANCE_FILTER");
  assert.deepEqual(parseDueFilters({ busId: "2" }), { archived: "false", busId: "2", page: 1, limit: 25 });
  rejects(() => parseDueFilters({ archived: "true" }), "INVALID_MAINTENANCE_FILTER");
});