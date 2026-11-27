import test from "node:test";
import assert from "node:assert/strict";
import { addDays, businessToday } from "../../utils/business-date.js";
import { classifyLicense, expiryWindowEnd } from "./license.js";

// Several reference days, including month, year and leap-day crossings.
for (const today of ["2026-03-10", "2026-12-15", "2028-02-01", "2028-02-29"]) {
  test(`expiry boundaries relative to ${today}`, () => {
    const on = (days) => classifyLicense(addDays(today, days), today);
    assert.equal(on(-1), "expired");
    assert.equal(on(0), "expiring_soon");
    assert.equal(on(30), "expiring_soon");
    assert.equal(on(31), "valid");
    assert.equal(expiryWindowEnd(today), addDays(today, 30));
  });
}

test("addDays crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-12-15", 30), "2027-01-14");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-03-01", -1), "2027-02-28");
});

test("business date follows the configured time zone, not UTC", () => {
  const instant = new Date("2026-12-15T20:30:00Z");
  assert.equal(businessToday(instant, "Asia/Karachi"), "2026-12-16");
  assert.equal(businessToday(instant, "UTC"), "2026-12-15");
  assert.equal(businessToday(instant, "America/New_York"), "2026-12-15");
  assert.equal(businessToday(new Date("2026-12-15T18:59:59Z"), "Asia/Karachi"), "2026-12-15");
  assert.equal(businessToday(new Date("2026-12-15T19:00:00Z"), "Asia/Karachi"), "2026-12-16");
});
