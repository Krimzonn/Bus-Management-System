import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. Behaviour against PostgreSQL is covered
// by scheduling.integration.test.js.
const read = (file) => fs.readFileSync(new URL(`../../database/migrations/${file}`, import.meta.url), "utf8");
const sql = read("012_scheduling.sql");

test("both overlap constraints use half-open ranges and ignore finished trips", () => {
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS btree_gist/);
  assert.match(sql, /'\[\)'/);
  for (const column of ["bus_id", "driver_id"]) {
    assert.match(sql, new RegExp(
      `EXCLUDE USING gist \\(\\s*${column} WITH =, trip_period WITH &&\\s*\\) WHERE \\(status IN \\('scheduled', 'in_progress'\\)\\)`,
    ));
  }
});

test("runtime grants allow no delete and do not touch audit privileges", () => {
  const grants = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));
  assert.deepEqual(grants.map((line) => line.trim()), [
    "GRANT SELECT, INSERT, UPDATE ON scheduling_schedules TO bus_app;",
  ]);
  assert.doesNotMatch(sql, /ON audit_logs/);
});

test("no migration adds a cross-module foreign key", () => {
  for (const file of ["010_fleet_bus_defaults.sql", "011_driver_account_link.sql", "012_scheduling.sql"]) {
    const statements = read(file).replace(/--.*$/gm, "");
    // The only references allowed are inside Identity & Access, which these do not add.
    assert.doesNotMatch(statements, /REFERENCES|FOREIGN KEY/i, file);
  }
});
