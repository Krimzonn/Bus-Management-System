import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. They do NOT execute the migration.
const sql = fs.readFileSync(new URL("../../database/migrations/008_routes.sql", import.meta.url), "utf8");
const grantLines = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));

test("migration creates the routes table with the required constraints", () => {
  assert.match(sql, /CREATE TABLE routes_routes/);
  assert.match(sql, /UNIQUE \(route_code\)/);
  assert.match(sql, /status IN \('unblocked', 'blocked'\)/);
  assert.match(sql, /archived_at TIMESTAMPTZ/);
});

test("migration registers both capabilities and the role matrix", () => {
  assert.match(sql, /'view-routes'/);
  assert.match(sql, /'manage-routes'/);
  assert.match(sql, /r\.role_key IN \('admin', 'transportation_manager'\)/);
  assert.match(sql, /r\.role_key = 'administrative_staff' AND c\.capability_key = 'view-routes'/);
});

test("runtime grants never allow deleting routes or mutating audit_logs", () => {
  const audit = grantLines.filter((line) => /\baudit_logs\b/.test(line));
  assert.ok(audit.length > 0);
  for (const line of audit) assert.doesNotMatch(line, /UPDATE|DELETE|TRUNCATE|ALL/i);
  for (const line of grantLines.filter((l) => /\broutes_routes\b/.test(l))) {
    assert.doesNotMatch(line, /DELETE|TRUNCATE|ALL/i);
  }
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM bus_app/);
});