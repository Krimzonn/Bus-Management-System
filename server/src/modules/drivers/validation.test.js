import test from "node:test";
import assert from "node:assert/strict";
import { parseLicenseCategory as parseBusCategory } from "../fleet/validation.js";
import {
  parseCreateInput, parseDriverId, parseExpiryFilters, parseLicenseCategory, parseLicenseExpiryDate,
  parseLicenseNumber, parseListFilters, parseStatus, parseStatusInput, parseUpdateInput,
} from "./validation.js";

const valid = {
  fullName: "  Ali   Raza ", licenseNumber: " lhr-12  345 ", licenseCategory: " htv ",
  licenseExpiryDate: "2027-05-31",
};
const rejects = (fn, code) => assert.throws(fn, { code, status: 400 });

test("create input normalizes values and defaults status to available", () => {
  assert.deepEqual(parseCreateInput(valid), {
    fullName: "Ali Raza", licenseNumber: "LHR-12 345", licenseCategory: "HTV",
    licenseExpiryDate: "2027-05-31", status: "available",
  });
});

test("create input requires every driver and license field", () => {
  for (const [field, code] of [
    ["fullName", "INVALID_DRIVER_NAME"], ["licenseNumber", "INVALID_LICENSE_NUMBER"],
    ["licenseCategory", "INVALID_LICENSE_CATEGORY"], ["licenseExpiryDate", "INVALID_LICENSE_EXPIRY_DATE"],
  ]) {
    for (const value of [undefined, null, "", "   ", 5]) {
      rejects(() => parseCreateInput({ ...valid, [field]: value }), code);
    }
  }
});

test("create input rejects unknown fields and non-objects", () => {
  for (const body of [null, [], "x", { ...valid, phone: "1" }, { ...valid, isArchived: true }]) {
    rejects(() => parseCreateInput(body), "INVALID_INPUT");
  }
});

test("names reject excess length and control characters", () => {
  assert.equal(parseCreateInput({ ...valid, fullName: "a".repeat(100) }).fullName.length, 100);
  rejects(() => parseCreateInput({ ...valid, fullName: "a".repeat(101) }), "INVALID_DRIVER_NAME");
  for (const char of ["\u0000", "\u007f", "\u0085", "\u009f"]) {
    rejects(() => parseCreateInput({ ...valid, fullName: `a${char}b` }), "INVALID_DRIVER_NAME");
  }
  assert.equal(parseCreateInput({ ...valid, fullName: "علی رضا" }).fullName, "علی رضا");
});

test("license numbers reject unsupported characters and excess length", () => {
  assert.equal(parseLicenseNumber("A".repeat(30)).length, 30);
  for (const value of ["A".repeat(31), "-123", "AB_12", "AB.12", "AB%"]) {
    rejects(() => parseLicenseNumber(value), "INVALID_LICENSE_NUMBER");
  }
});

test("expiry date must be a real YYYY-MM-DD calendar date", () => {
  assert.equal(parseLicenseExpiryDate("2028-02-29"), "2028-02-29");
  assert.equal(parseLicenseExpiryDate("2000-01-01"), "2000-01-01"); // already expired is recordable
  for (const value of [
    "2027-02-29", "2027-02-30", "2027-13-01", "2027-00-10", "2027-1-5", "31-12-2027",
    "2027-12-31T00:00:00Z", " 2027-12-31", "1899-12-31", "tomorrow", 20271231,
  ]) {
    rejects(() => parseLicenseExpiryDate(value), "INVALID_LICENSE_EXPIRY_DATE");
  }
});

test("category accepts and rejects exactly what Fleet does", () => {
  const outcome = (parse, value) => {
    try { return parse(value); } catch (error) { return error.code; }
  };
  for (const value of ["htv", " LTV ", "PSV  A", "D-1", "", "A".repeat(20), "A".repeat(21), "H_TV", "-A", null]) {
    assert.equal(outcome(parseLicenseCategory, value), outcome(parseBusCategory, value), String(value));
  }
});

test("status accepts only the three lowercase values", () => {
  for (const status of ["available", "on_leave", "absent"]) assert.equal(parseStatus(status), status);
  for (const status of ["Available", "ON_LEAVE", "on leave", "inactive", "", null, undefined]) {
    rejects(() => parseStatus(status), "INVALID_DRIVER_STATUS");
  }
  rejects(() => parseStatusInput({ status: "absent", reason: "x" }), "INVALID_INPUT");
});

test("update input is partial and cannot change status or archival", () => {
  assert.deepEqual(parseUpdateInput({ licenseCategory: "ltv" }), { licenseCategory: "LTV" });
  for (const body of [{}, { status: "absent" }, { isArchived: false }]) {
    rejects(() => parseUpdateInput(body), "INVALID_INPUT");
  }
  rejects(() => parseUpdateInput({ licenseNumber: null }), "INVALID_LICENSE_NUMBER");
});

test("driver id validation", () => {
  assert.equal(parseDriverId("12"), "12");
  for (const id of ["0", "-1", "1.5", "abc", "", 3, "1".repeat(19)]) {
    rejects(() => parseDriverId(id), "INVALID_DRIVER_ID");
  }
});

test("list filters apply defaults and reject bad values", () => {
  assert.deepEqual(parseListFilters({}), { archived: "false", page: 1, limit: 25 });
  assert.equal(parseListFilters({ licenseCategory: "htv" }).licenseCategory, "HTV");
  for (const query of [
    { status: "x" }, { licenseStatus: "soon" }, { archived: "yes" }, { q: ["a", "b"] },
    { q: "a".repeat(101) }, { q: "a\u0000" }, { licenseCategory: "%" },
  ]) {
    rejects(() => parseListFilters(query), "INVALID_DRIVER_FILTER");
  }
  rejects(() => parseListFilters({ limit: "101" }), "INVALID_PAGINATION");
  rejects(() => parseListFilters({ page: "0" }), "INVALID_PAGINATION");
});

test("expiry filters default to expiring_soon and never include archived drivers", () => {
  assert.deepEqual(parseExpiryFilters({}), {
    archived: "false", licenseStatus: "expiring_soon", page: 1, limit: 25,
  });
  for (const state of ["valid", "expiring_soon", "expired"]) {
    assert.equal(parseExpiryFilters({ state }).licenseStatus, state);
  }
  for (const query of [{ state: "all" }, { archived: "true" }, { status: "available" }]) {
    rejects(() => parseExpiryFilters(query), "INVALID_DRIVER_FILTER");
  }
});
