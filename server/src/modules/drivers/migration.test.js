import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. Behaviour against PostgreSQL is covered
// by drivers.integration.test.js.
const sql = fs.readFileSync(new URL("../../database/migrations/009_drivers.sql", import.meta.url), "utf8");

test("migration enforces license uniqueness, statuses and archival", () => {
  assert.match(sql, /CREATE UNIQUE INDEX drivers_drivers_license_key/);
  assert.match(sql, /status IN \('available', 'on_leave', 'absent'\)/);
  assert.match(sql, /license_expiry_date DATE NOT NULL/);
  assert.match(sql, /drivers_drivers_archive_consistency/);
});

test("migration grants the view-only role no manage capability", () => {
  assert.match(sql, /r\.role_key IN \('admin', 'transportation_manager'\)/);
  assert.match(sql, /r\.role_key = 'administrative_staff' AND c\.capability_key = 'view-drivers'/);
});

test("runtime grants allow no delete and do not touch audit privileges", () => {
  const grants = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));
  assert.deepEqual(grants.map((line) => line.trim()), [
    "GRANT SELECT, INSERT, UPDATE ON drivers_drivers TO bus_app;",
  ]);
  assert.doesNotMatch(sql, /ON audit_logs/);
});
