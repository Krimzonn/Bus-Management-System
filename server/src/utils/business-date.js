import { env } from "../config/env.js";

// Business dates are calendar dates ("YYYY-MM-DD" strings), never instants.
// ISO strings of this shape compare correctly with <, <= and ===.

// Today's calendar date in the organization's time zone (BUSINESS_TIMEZONE).
export function businessToday(now = new Date(), timeZone = env.businessTimezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Calendar arithmetic is done in UTC so that daylight saving never shifts a date.
export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Rejects impossible dates such as 2026-02-30, which Date would roll forward.
  return addDays(value, 0) === value;
}
