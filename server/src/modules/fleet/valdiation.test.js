import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBusId, parseBusNumber, parseCreateInput, parseLicenseCategory,
  parseListFilters, parseSeatingCapacity, parseStatus, parseUpdateInput,
} from "./validation.js";

test("normalizes bus numbers and rejects invalid ones", () => {
  assert.equal(parseBusNumber("  bus   101 "), "BUS 101");
  assert.equal(parseBusNumber("A"), "A");
  for (const bad of ["", "   ", "-A", "BUS#1", "A".repeat(31), 5, null, undefined]) {
    assert.throws(() => parseBusNumber(bad), { code: "INVALID_BUS_NUMBER" });
  }
});

test("seating capacity boundaries", () => {
  assert.equal(parseSeatingCapacity(1), 1);
  assert.equal(parseSeatingCapacity(100), 100);
  for (const bad of [0, 101, -1, 1.5, "10", null, undefined, NaN]) {
    assert.throws(() => parseSeatingCapacity(bad), { code: "INVALID_SEATING_CAPACITY" });
  }
});

test("status and license category validation", () => {
  assert.equal(parseStatus("under_maintenance"), "under_maintenance");
  assert.throws(() => parseStatus("Active"), { code: "INVALID_BUS_STATUS" });
  assert.equal(parseLicenseCategory(" htv "), "HTV");
  assert.throws(() => parseLicenseCategory(""), { code: "INVALID_LICENSE_CATEGORY" });
  assert.throws(() => parseLicenseCategory("X".repeat(21)), { code: "INVALID_LICENSE_CATEGORY" });
});

test("bus id validation", () => {
  assert.equal(parseBusId("12"), "12");
  for (const bad of ["0", "-1", "abc", "1".repeat(19), 5, undefined]) {
    assert.throws(() => parseBusId(bad), { code: "INVALID_BUS_ID" });
  }
});

test("create input defaults status and rejects unknown fields", () => {
  const bus = parseCreateInput({ busNumber: "b-1", seatingCapacity: 40, requiredLicenseCategory: "htv" });
  assert.deepEqual(bus, { busNumber: "B-1", seatingCapacity: 40, requiredLicenseCategory: "HTV", status: "active" });
  assert.throws(() => parseCreateInput(undefined), { code: "INVALID_INPUT" });
  assert.throws(
    () => parseCreateInput({ busNumber: "B1", seatingCapacity: 40, requiredLicenseCategory: "HTV", isArchived: true }),
    { code: "INVALID_INPUT" },
  );
});

test("update input rejects empty bodies and status changes", () => {
  assert.throws(() => parseUpdateInput({}), { code: "INVALID_INPUT" });
  assert.throws(() => parseUpdateInput({ status: "inactive" }), { code: "INVALID_INPUT" });
  assert.deepEqual(parseUpdateInput({ seatingCapacity: 30 }), { seatingCapacity: 30 });
});

test("list filters apply defaults and reject bad values", () => {
  assert.deepEqual(parseListFilters({}), { archived: "false", page: 1, limit: 25 });
  assert.equal(parseListFilters({ q: " bus " }).q, "BUS");
  assert.equal(parseListFilters({ archived: "all" }).archived, "all");
  assert.throws(() => parseListFilters({ status: "broken" }), { code: "INVALID_BUS_FILTER" });
  assert.throws(() => parseListFilters({ archived: "maybe" }), { code: "INVALID_BUS_FILTER" });
  assert.throws(() => parseListFilters({ q: ["a", "b"] }), { code: "INVALID_BUS_FILTER" });
  assert.throws(() => parseListFilters({ page: "0" }), { code: "INVALID_PAGINATION" });
  assert.throws(() => parseListFilters({ limit: "101" }), { code: "INVALID_PAGINATION" });
});