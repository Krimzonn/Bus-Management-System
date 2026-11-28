import test from "node:test";
import assert from "node:assert/strict";
import {
  application,
  transition,
  interview,
  id,
  listFilters,
} from "./validation.js";
test("valid application normalizes text and supports Urdu names", () => {
  assert.deepEqual(
    application({ fullName: "  علی رضا ", experience: " 10 years " }),
    { fullName: "علی رضا", experience: "10 years" },
  );
});
test("application rejects missing, malformed, oversized and client-owned fields", () => {
  for (const input of [
    null,
    [],
    {},
    { fullName: "123", experience: "yes" },
    { fullName: "Ali", experience: "" },
    { fullName: "Ali", experience: 1 },
    { fullName: "Ali", experience: "x".repeat(256) },
    { fullName: "Ali", experience: "ok", applicantId: "3" },
    { fullName: "Ali\u0000", experience: "ok" },
  ])
    assert.throws(() => application(input));
});
test("valid transitions and recorded outcome for final decision", () => {
  for (const [from, to, outcome] of [
    ["submitted", "under_review", null],
    ["under_review", "test_interview", null],
    ["test_interview", "selected", "passed"],
    ["test_interview", "rejected", "failed"],
  ])
    assert.doesNotThrow(() => transition(from, to, outcome));
});
test("invalid, skipped, reversed and finalized transitions are rejected", () => {
  for (const [from, to, outcome] of [
    ["submitted", "selected", "passed"],
    ["submitted", "submitted", null],
    ["under_review", "selected", "passed"],
    ["test_interview", "selected", null],
    ["test_interview", "rejected", null],
    ["selected", "rejected", "passed"],
    ["rejected", "test_interview", "failed"],
    ["test_interview", "under_review", "passed"],
  ])
    assert.throws(() => transition(from, to, outcome), {
      code: "INVALID_APPLICATION_TRANSITION",
    });
});
test("interview scheduling and outcome recording", () => {
  assert.deepEqual(
    interview({ date: "2027-01-01", notes: "", outcome: "" }, "2026-12-01"),
    { date: "2027-01-01", notes: null, outcome: null },
  );
  assert.deepEqual(
    interview(
      { date: "2026-11-01", notes: "Completed", outcome: "passed" },
      "2026-12-01",
    ),
    { date: "2026-11-01", notes: "Completed", outcome: "passed" },
  );
});
test("reject invalid dates, outcomes, future completed interview and missing outcome notes", () => {
  for (const input of [
    { date: "2026-02-30", notes: "ok", outcome: "passed" },
    { date: "2027-01-01", notes: "ok", outcome: "passed" },
    { date: "2026-11-01", notes: "ok", outcome: "unknown" },
    { date: "2026-11-01", notes: "", outcome: "completed" },
    { date: "2026-11-01", notes: "x".repeat(256), outcome: "completed" },
  ])
    assert.throws(() => interview(input, "2026-12-01"), {
      code: "INVALID_RECRUITMENT_INPUT",
    });
});
test("invalid application identifiers rejected", () => {
  for (const value of [
    "0",
    "abc",
    "1.5",
    "-1",
    "01",
    "9999999999999999999",
    1,
    null,
  ])
    assert.throws(() => id(value));
  assert.equal(id("12"), "12");
});
test("recruitment filter and pagination validation", () => {
  assert.deepEqual(
    listFilters({ q: " Ali ", status: "selected", page: "2", limit: "25" }),
    { q: "Ali", status: "selected", page: 2, limit: 25 },
  );
  for (const filters of [
    { page: "0" },
    { limit: "101" },
    { status: "other" },
    { page: ["1", "2"] },
    { q: "x".repeat(101) },
    { owner: "1" },
  ])
    assert.throws(() => listFilters(filters));
});
