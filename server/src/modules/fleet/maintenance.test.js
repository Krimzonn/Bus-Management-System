import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../../utils/business-date.js";
import { listMaintenanceDueAlerts } from "./index.js";

test("overdue and upcoming records are reported; due today is upcoming, day 31 is not due", async () => {
  const today = "2026-12-15";
  const rows = [
    {
      id: "1",
      bus_number: "B-1",
      maintenance_type: "Oil",
      next_service_date: addDays(today, -1),
    },
    {
      id: "2",
      bus_number: "B-2",
      maintenance_type: "Tyres",
      next_service_date: today,
    },
    {
      id: "3",
      bus_number: "B-3",
      maintenance_type: "Brakes",
      next_service_date: addDays(today, 30),
    },
    {
      id: "4",
      bus_number: "B-4",
      maintenance_type: "Belt",
      next_service_date: addDays(today, 31),
    },
  ];
  const calls = [];
  const executor = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows };
    },
  };
  const alerts = await listMaintenanceDueAlerts(executor, today);
  assert.deepEqual(
    alerts.map((a) => [a.recordId, a.status]),
    [
      ["1", "overdue"],
      ["2", "upcoming"],
      ["3", "upcoming"],
    ],
  );
  assert.equal(alerts[0].busNumber, "B-1");
  assert.equal(alerts[0].maintenanceType, "Oil");
  assert.equal(alerts[0].nextServiceDate, "2026-12-14");
  assert.match(
    calls[0].sql,
    /m\.archived_at IS NULL AND b\.is_archived = FALSE/,
  );
  assert.match(calls[0].sql, /m\.next_service_date IS NOT NULL/);
  assert.deepEqual(calls[0].values, [today]);
});
