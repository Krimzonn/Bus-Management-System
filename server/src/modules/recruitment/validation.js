export const statuses = [
  "submitted",
  "under_review",
  "test_interview",
  "selected",
  "rejected",
];
export const error = (code, status = 400) =>
  Object.assign(new Error(code), { code, status });
export function object(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw error("INVALID_INPUT");
  return input;
}
export function string(value, max, required = true) {
  if (!required && (value == null || value === "")) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /\p{Cc}/u.test(value)
  )
    throw error("INVALID_RECRUITMENT_INPUT");
  return value.trim();
}
export function id(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,17}$/.test(value))
    throw error("INVALID_APPLICATION_ID");
  return value;
}
export function application(input) {
  const { fullName, experience } = object(input, ["fullName", "experience"]);
  const name = string(fullName, 100);
  if (!/\p{L}/u.test(name)) throw error("INVALID_RECRUITMENT_INPUT");
  return { fullName: name, experience: string(experience, 255) };
}
export function transition(current, next, outcome) {
  if (
    !(
      (current === "submitted" && next === "under_review") ||
      (current === "under_review" && next === "test_interview") ||
      (current === "test_interview" &&
        ["selected", "rejected"].includes(next) &&
        ["passed", "failed", "completed"].includes(outcome))
    )
  )
    throw error("INVALID_APPLICATION_TRANSITION", 409);
}
export function interview(input, today) {
  const { date, notes, outcome } = object(input, ["date", "notes", "outcome"]);
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date < "1900-01-01"
  )
    throw error("INVALID_RECRUITMENT_INPUT");
  const result = outcome === "" || outcome == null ? null : outcome;
  if (result !== null && !["passed", "failed", "completed"].includes(result))
    throw error("INVALID_RECRUITMENT_INPUT");
  if (result !== null && today && date > today)
    throw error("INVALID_RECRUITMENT_INPUT");
  return { date, notes: string(notes, 255, result !== null), outcome: result };
}
export function listFilters(input) {
  const {
    q,
    status,
    page = "1",
    limit = "25",
  } = object(input, ["q", "status", "page", "limit"]);
  function integer(value, max) {
    if (
      typeof value !== "string" ||
      !/^\d{1,5}$/.test(value) ||
      Number(value) < 1 ||
      Number(value) > max
    )
      throw error("INVALID_PAGINATION");
    return Number(value);
  }
  if (status !== undefined && !statuses.includes(status))
    throw error("INVALID_RECRUITMENT_INPUT");
  return {
    q: string(typeof q === "string" ? q.trim() : q, 100, false),
    status: status ?? null,
    page: integer(page, 10000),
    limit: integer(limit, 100),
  };
}
