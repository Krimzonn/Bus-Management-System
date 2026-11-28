import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCreateInput, parseHistoryFilters, parseLiters, parseListFilters, parseOdometer,
  parsePurchaseDate, parseSummaryFilters, parseTotalCost, parseUpdateInput,
} from "./validation.js";

const valid = { busId: "1", purchaseDate: "2026-11-01", liters: 40.5, totalCost: "60", odometer: 12000 };
const rejects = (fn, code, status = 400) => assert.throws(fn, { code, status });

test("create input normalizes decimals and accepts numeric ids", () => {
  assert.deepEqual(parseCreateInput(valid), {
    busId: "1", purchaseDate: "2026-11-01", liters: "40.50", totalCost: "60.00", odometer: 12000,
  });
  assert.equal(parseCreateInput({ ...valid, busId: 7 }).busId, "7");
  assert.equal(parseCreateInput({ ...valid, busId: "007" }).busId, "7");
});

test("every field is required on create", () => {
  for (const [field, code] of [
    ["busId", "INVALID_BUS_ID"], ["purchaseDate", "INVALID_PURCHASE_DATE"], ["liters", "INVALID_LITERS"],
    ["totalCost", "INVALID_TOTAL_COST"], ["odometer", "INVALID_ODOMETER"],
  ]) {
    for (const value of [undefined, null]) rejects(() => parseCreateInput({ ...valid, [field]: value }), code);
  }
});

test("bus id must be a positive id", () => {
  for (const busId of ["0", "-1", "abc", "", 1.5, "1".repeat(19), {}, []]) {
    rejects(() => parseCreateInput({ ...valid, busId }), "INVALID_BUS_ID");
  }
});

test("purchase date must be a real calendar date in range", () => {
  assert.equal(parsePurchaseDate("1900-01-01"), "1900-01-01");
  assert.equal(parsePurchaseDate("2028-02-29"), "2028-02-29");
  assert.equal(parsePurchaseDate("9999-12-30"), "9999-12-30");
  for (const value of [
    "1899-12-31", "9999-12-31", "2027-02-30", "2027-13-01", "2027-1-5", "2027-12-31T00:00:00Z",
    "", null, undefined, 20271231,
  ]) rejects(() => parsePurchaseDate(value), "INVALID_PURCHASE_DATE");
});

test("liters must be greater than zero with at most 2 decimals and 8 integer digits", () => {
  assert.equal(parseLiters("0.01"), "0.01");
  assert.equal(parseLiters(99999999.99), "99999999.99");
  assert.equal(parseLiters(" 12.3 "), "12.30");
  for (const value of [
    0, "0", "0.00", -1, "-0.5", "100000000", "1.234", "abc", "", "1e3", ".5", "5.",
    NaN, Infinity, -Infinity, null, undefined, true, {}, 0.1 + 0.2,
  ]) rejects(() => parseLiters(value), "INVALID_LITERS");
});

test("total cost may be zero, never negative, with at most 2 decimals and 10 integer digits", () => {
  assert.equal(parseTotalCost(0), "0.00");
  assert.equal(parseTotalCost("150.5"), "150.50");
  assert.equal(parseTotalCost(9999999999.99), "9999999999.99");
  for (const value of [
    -1, "-0.01", "10000000000", "9999999999.995", "1.234", "abc", "", "1e3", NaN, Infinity,
    -Infinity, null, undefined, true, {},
  ]) rejects(() => parseTotalCost(value), "INVALID_TOTAL_COST");
});

test("odometer is a whole number from 0 to 9,999,999", () => {
  assert.equal(parseOdometer(0), 0);
  assert.equal(parseOdometer(9999999), 9999999);
  for (const value of [-1, 10000000, 1.5, "100", NaN, Infinity, -Infinity, null, undefined, true]) {
    rejects(() => parseOdometer(value), "INVALID_ODOMETER");
  }
});

test("create input rejects unknown fields and non-objects", () => {
  for (const body of [null, undefined, [], "x", { ...valid, isArchived: true }, { ...valid, createdBy: "1" }]) {
    rejects(() => parseCreateInput(body), "INVALID_INPUT");
  }
});

test("update input is partial, non-empty and cannot change the bus", () => {
  assert.deepEqual(parseUpdateInput({ liters: "20" }), { liters: "20.00" });
  assert.deepEqual(parseUpdateInput({ odometer: 5, totalCost: 0 }), { odometer: 5, totalCost: "0.00" });
  for (const body of [{}, { busId: "2" }, { archivedAt: "x" }]) rejects(() => parseUpdateInput(body), "INVALID_INPUT");
  rejects(() => parseUpdateInput({ liters: null }), "INVALID_LITERS");
  rejects(() => parseUpdateInput({ odometer: -1 }), "INVALID_ODOMETER");
});

test("list filters apply defaults and reject bad values", () => {
  assert.deepEqual(parseListFilters({}), { archived: "false", page: 1, limit: 25 });
  assert.deepEqual(
    parseListFilters({ busId: "3", purchaseFrom: "2026-01-01", purchaseTo: "2026-01-01", archived: "all", page: "2", limit: "10" }),
    { archived: "all", busId: "3", purchaseFrom: "2026-01-01", purchaseTo: "2026-01-01", page: 2, limit: 10 },
  );
  for (const query of [
    { archived: "maybe" }, { busId: "x" }, { busId: ["1", "2"] }, { purchaseFrom: "2026-02-30" },
    { q: "x" }, { status: "x" },
  ]) rejects(() => parseListFilters(query), "INVALID_FUEL_FILTER");
  rejects(() => parseListFilters({ purchaseFrom: "2026-02-01", purchaseTo: "2026-01-01" }), "INVALID_DATE_RANGE");
  rejects(() => parseListFilters({ page: "0" }), "INVALID_PAGINATION");
  rejects(() => parseListFilters({ limit: "101" }), "INVALID_PAGINATION");
});

test("history includes archived records by default and takes no bus filter", () => {
  assert.equal(parseHistoryFilters({}).archived, "all");
  assert.equal(parseHistoryFilters({ archived: "false" }).archived, "false");
  rejects(() => parseHistoryFilters({ busId: "1" }), "INVALID_FUEL_FILTER");
});

test("summary needs a valid inclusive range and excludes archived by default", () => {
  assert.deepEqual(parseSummaryFilters({ startDate: "2026-01-01", endDate: "2026-01-01" }),
    { startDate: "2026-01-01", endDate: "2026-01-01", archived: "false" });
  assert.deepEqual(parseSummaryFilters({ startDate: "2026-01-01", endDate: "2026-02-01", busId: "4", archived: "all" }),
    { startDate: "2026-01-01", endDate: "2026-02-01", archived: "all", busId: "4" });
  rejects(() => parseSummaryFilters({ startDate: "2026-02-02", endDate: "2026-02-01" }), "INVALID_DATE_RANGE");
  for (const query of [
    {}, { startDate: "2026-01-01" }, { endDate: "2026-01-01" }, { startDate: "bad", endDate: "2026-01-01" },
    { startDate: "2026-01-01", endDate: "2026-01-02", archived: "true" },
    { startDate: "2026-01-01", endDate: "2026-01-02", page: "1" },
  ]) rejects(() => parseSummaryFilters(query), "INVALID_FUEL_FILTER");
});