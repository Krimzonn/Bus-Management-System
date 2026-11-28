import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../../utils/business-date.js";
import { getAccountIdForDriver, listLicenseAlerts } from "./index.js";

const executorFor = (rows) => ({
  calls: [],
  async query(sql, values) {
    this.calls.push({ sql, values });
    return { rows };
  },
});

test("the linked account id is returned as text, or null", async () => {
  assert.equal(
    await getAccountIdForDriver("5", executorFor([{ account_user_id: 42 }])),
    "42",
  );
  assert.equal(
    await getAccountIdForDriver("5", executorFor([{ account_user_id: null }])),
    null,
  );
  assert.equal(await getAccountIdForDriver("5", executorFor([])), null);
  await assert.rejects(getAccountIdForDriver("abc", executorFor([])), {
    code: "INVALID_DRIVER_ID",
  });
});

test("license alerts cover expired and the inclusive 30-day window on the business date", async () => {
  const today = "2026-12-15";
  const executor = executorFor([
    { id: "1", full_name: "Expired", license_expiry_date: addDays(today, -1) },
    { id: "2", full_name: "Today", license_expiry_date: today },
    { id: "3", full_name: "Day30", license_expiry_date: addDays(today, 30) },
    { id: "4", full_name: "Day31", license_expiry_date: addDays(today, 31) }, // never returned by SQL; filtered defensively
  ]);
  const alerts = await listLicenseAlerts(executor, today);
  assert.deepEqual(
    alerts.map((a) => [a.driverId, a.state]),
    [
      ["1", "expired"],
      ["2", "expiring_soon"],
      ["3", "expiring_soon"],
    ],
  );
  assert.deepEqual(executor.calls[0].values, [addDays(today, 30)]);
  assert.match(
    executor.calls[0].sql,
    /is_archived = FALSE AND license_expiry_date <= \$1::date/,
  );
  assert.equal(alerts[0].fullName, "Expired");
  assert.equal(alerts[0].licenseExpiryDate, "2026-12-14");
});
