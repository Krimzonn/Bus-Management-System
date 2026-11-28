import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. Behaviour against PostgreSQL is covered
// by maintenance.integration.test.js.
const sql = fs.readFileSync(new URL("../../database/migrations/014_fleet_maintenance.sql", import.meta.url), "utf8");

test("table references buses without cascading deletes and keeps archival nullable", () => {
  assert.match(sql, /CREATE TABLE fleet_maintenance_records/);
  assert.match(sql, /REFERENCES fleet_buses \(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  assert.match(sql, /archived_at TIMESTAMPTZ,/);
});

test("database enforces cost, odometer, dates and required text", () => {
  assert.match(sql, /cost NUMERIC\(12, 2\) NOT NULL/);
  assert.match(sql, /CHECK \(cost >= 0\)/);
  assert.match(sql, /odometer BETWEEN 0 AND 9999999/);
  assert.match(sql, /next_service_date >= service_date/);
  assert.match(sql, /char_length\(maintenance_type\) BETWEEN 1 AND 100/);
  assert.match(sql, /char_length\(work_description\) BETWEEN 1 AND 255/);
});

test("indexes serve bus history and due review", () => {
  assert.match(sql, /\(bus_id, service_date DESC, id DESC\)/);
  assert.match(sql, /WHERE archived_at IS NULL AND next_service_date IS NOT NULL/);
});

test("capabilities: three roles view and manage, only admin archives", () => {
  for (const key of ["view-maintenance", "manage-maintenance", "archive-maintenance"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.match(sql, /r\.role_key IN \('admin', 'administrative_staff', 'transportation_manager'\)/);
  assert.match(sql, /r\.role_key = 'admin' AND c\.capability_key = 'archive-maintenance'/);
});

test("runtime grants allow no delete and do not touch audit privileges", () => {
  const grants = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));
  assert.deepEqual(grants.map((line) => line.trim()), [
    "GRANT SELECT, INSERT, UPDATE ON fleet_maintenance_records TO bus_app;",
  ]);
  assert.match(sql, /REVOKE DELETE, TRUNCATE ON fleet_maintenance_records FROM bus_app/);
  assert.doesNotMatch(sql, /ON audit_logs/);
});