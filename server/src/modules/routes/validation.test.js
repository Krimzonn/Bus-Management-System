import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCreateInput, parseListFilters, parseRouteCode, parseRouteId, parseSelectableFilters,
  parseStatus, parseStatusInput, parseUpdateInput,
} from "./validation.js";

const valid = { routeCode: "r-101", name: "City  Centre to Airport", origin: "City Centre", destination: "Airport" };

test("normalizes route codes and rejects invalid ones", () => {
  assert.equal(parseRouteCode("  r  101 "), "R 101");
  assert.equal(parseRouteCode("A"), "A");
  for (const bad of ["", "   ", "-A", "R#1", "A".repeat(31), 5, null, undefined]) {
    assert.throws(() => parseRouteCode(bad), { code: "INVALID_ROUTE_CODE" });
  }
});

test("status accepts only unblocked and blocked", () => {
  assert.equal(parseStatus("blocked"), "blocked");
  assert.equal(parseStatus("unblocked"), "unblocked");
  for (const bad of ["Blocked", "active", "", null, undefined, 1]) {
    assert.throws(() => parseStatus(bad), { code: "INVALID_ROUTE_STATUS" });
  }
  assert.equal(parseStatusInput({ status: "blocked" }), "blocked");
  assert.throws(() => parseStatusInput({ status: "blocked", extra: 1 }), { code: "INVALID_INPUT" });
});

test("route id validation", () => {
  assert.equal(parseRouteId("12"), "12");
  for (const bad of ["0", "-1", "abc", "1".repeat(19), 5, undefined]) {
    assert.throws(() => parseRouteId(bad), { code: "INVALID_ROUTE_ID" });
  }
});

test("create input normalizes text, defaults status and rejects unknown fields", () => {
  assert.deepEqual(parseCreateInput(valid), {
    routeCode: "R-101", name: "City Centre to Airport", origin: "City Centre",
    destination: "Airport", status: "unblocked",
  });
  assert.equal(parseCreateInput({ ...valid, status: "blocked" }).status, "blocked");
  assert.throws(() => parseCreateInput(undefined), { code: "INVALID_INPUT" });
  assert.throws(() => parseCreateInput([]), { code: "INVALID_INPUT" });
  assert.throws(() => parseCreateInput({ ...valid, isArchived: true }), { code: "INVALID_INPUT" });
});

test("create input rejects missing or invalid fields", () => {
  const without = (key) => Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
  assert.throws(() => parseCreateInput(without("routeCode")), { code: "INVALID_ROUTE_CODE" });
  assert.throws(() => parseCreateInput(without("name")), { code: "INVALID_ROUTE_NAME" });
  assert.throws(() => parseCreateInput(without("origin")), { code: "INVALID_ROUTE_ORIGIN" });
  assert.throws(() => parseCreateInput(without("destination")), { code: "INVALID_ROUTE_DESTINATION" });
  assert.throws(() => parseCreateInput({ ...valid, name: "   " }), { code: "INVALID_ROUTE_NAME" });
  assert.throws(() => parseCreateInput({ ...valid, name: "x".repeat(101) }), { code: "INVALID_ROUTE_NAME" });
  assert.throws(() => parseCreateInput({ ...valid, origin: "Bad\u0000Name" }), { code: "INVALID_ROUTE_ORIGIN" });
  assert.throws(() => parseCreateInput({ ...valid, destination: 42 }), { code: "INVALID_ROUTE_DESTINATION" });
  assert.throws(() => parseCreateInput({ ...valid, status: "Blocked" }), { code: "INVALID_ROUTE_STATUS" });
  assert.equal(parseCreateInput({ ...valid, name: "x".repeat(100) }).name.length, 100);
});

test("update input rejects empty bodies and status changes", () => {
  assert.throws(() => parseUpdateInput({}), { code: "INVALID_INPUT" });
  assert.throws(() => parseUpdateInput({ status: "blocked" }), { code: "INVALID_INPUT" });
  assert.throws(() => parseUpdateInput({ name: "" }), { code: "INVALID_ROUTE_NAME" });
  assert.deepEqual(parseUpdateInput({ name: " New  name " }), { name: "New name" });
});

test("list filters apply defaults and reject bad values", () => {
  assert.deepEqual(parseListFilters({}), { archived: "false", page: 1, limit: 25 });
  assert.equal(parseListFilters({ q: " airport " }).q, "airport");
  assert.equal(parseListFilters({ q: "   " }).q, undefined);
  assert.equal(parseListFilters({ archived: "all" }).archived, "all");
  assert.equal(parseListFilters({ status: "blocked" }).status, "blocked");
  assert.throws(() => parseListFilters({ status: "broken" }), { code: "INVALID_ROUTE_FILTER" });
  assert.throws(() => parseListFilters({ archived: "maybe" }), { code: "INVALID_ROUTE_FILTER" });
  assert.throws(() => parseListFilters({ q: ["a", "b"] }), { code: "INVALID_ROUTE_FILTER" });
  assert.throws(() => parseListFilters({ q: "x".repeat(101) }), { code: "INVALID_ROUTE_FILTER" });
  assert.throws(() => parseListFilters({ page: "0" }), { code: "INVALID_PAGINATION" });
  assert.throws(() => parseListFilters({ limit: "101" }), { code: "INVALID_PAGINATION" });
  assert.throws(() => parseListFilters({ page: "1.5" }), { code: "INVALID_PAGINATION" });
});

test("selectable filters fix status and archive state and reject overrides", () => {
  assert.deepEqual(parseSelectableFilters({ q: "a", page: "2" }), {
    archived: "false", status: "unblocked", q: "a", page: 2, limit: 25,
  });
  assert.throws(() => parseSelectableFilters({ status: "blocked" }), { code: "INVALID_ROUTE_FILTER" });
  assert.throws(() => parseSelectableFilters({ archived: "all" }), { code: "INVALID_ROUTE_FILTER" });
});