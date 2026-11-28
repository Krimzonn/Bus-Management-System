import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. Behaviour against PostgreSQL is covered
// by fuel.integration.test.js.
const sql = fs.readFileSync(new URL("../../database/migrations/015_fuel.sql", import.meta.url), "utf8");
const code = sql.replace(/--.*$/gm, "");

test("table enforces liters, cost, odometer, dates and archival at the database level", () => {
  assert.match(code, /CREATE TABLE fuel_purchases/);
  assert.match(code, /liters NUMERIC\(10, 2\) NOT NULL/);
  assert.match(code, /total_cost NUMERIC\(12, 2\) NOT NULL/);
  assert.match(code, /CHECK \(liters > 0\)/);
  assert.match(code, /CHECK \(total_cost >= 0\)/);
  assert.match(code, /odometer BETWEEN 0 AND 9999999/);
  assert.match(code, /purchase_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-30'/);
  assert.match(code, /archived_at TIMESTAMPTZ,/);
  assert.match(code, /\(archived_at IS NULL\) = \(archived_by IS NULL\)/);
});

test("no cross-module foreign key and no cascading delete", () => {
  assert.doesNotMatch(code, /REFERENCES|FOREIGN KEY/i);
  assert.doesNotMatch(code, /ON DELETE CASCADE/i);
});

test("a trigger backs up the odometer rule with the application's advisory lock key", () => {
  assert.match(code, /CREATE TRIGGER fuel_purchases_odometer_sequence/);
  assert.match(code, /BEFORE INSERT OR UPDATE ON fuel_purchases/);
  assert.match(code, /hashtextextended\('fuel:bus:' \|\| NEW\.bus_id::text, 0\)/);
  assert.match(code, /CONSTRAINT = 'fuel_purchases_odometer_sequence'/);
  assert.match(code, /f\.archived_at IS NULL/);
});

test("indexes serve bus history, dates and active records", () => {
  assert.match(code, /\(bus_id, purchase_date, odometer, id\)\s+WHERE archived_at IS NULL/);
  assert.match(code, /idx_fuel_purchases_bus_history/);
  assert.match(code, /\(purchase_date DESC, id DESC\)/);
});

test("capabilities: three roles view and manage, only admin archives", () => {
  for (const key of ["view-fuel", "manage-fuel", "archive-fuel"]) assert.match(code, new RegExp(`'${key}'`));
  assert.match(code, /r\.role_key IN \('admin', 'administrative_staff', 'transportation_manager'\)/);
  assert.match(code, /r\.role_key = 'admin' AND c\.capability_key = 'archive-fuel'/);
});

test("runtime grants allow no delete and do not touch audit privileges", () => {
  const grants = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));
  assert.deepEqual(grants.map((line) => line.trim()), ["GRANT SELECT, INSERT, UPDATE ON fuel_purchases TO bus_app;"]);
  assert.match(code, /REVOKE DELETE, TRUNCATE ON fuel_purchases FROM bus_app/);
  assert.doesNotMatch(code, /ON audit_logs/);
});