import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks on the SQL text only. Behaviour against PostgreSQL is covered by
// notifications.integration.test.js.
const sql = fs.readFileSync(
  new URL("../../database/migrations/016_notifications.sql", import.meta.url),
  "utf8",
);
const code = sql.replace(/--.*$/gm, "");

test("table has no cross-module foreign key and enforces its fields", () => {
  assert.match(code, /CREATE TABLE notifications_notifications/);
  assert.doesNotMatch(code, /REFERENCES|FOREIGN KEY/i);
  assert.match(code, /recipient_id > 0/);
  assert.match(code, /\(entity_type IS NULL\) = \(entity_id IS NULL\)/);
  assert.match(code, /read_at TIMESTAMPTZ,/);
});

test("duplicates are prevented by a partial unique index", () => {
  assert.match(
    code,
    /CREATE UNIQUE INDEX notifications_notifications_dedupe_key/,
  );
  assert.match(
    code,
    /\(recipient_id, dedupe_key\)\s+WHERE dedupe_key IS NOT NULL/,
  );
});

test("indexes serve history and unread queries", () => {
  assert.match(code, /\(recipient_id, created_at DESC, id DESC\)/);
  assert.match(code, /\(recipient_id\)\s+WHERE read_at IS NULL/);
});

test("history is retained: no delete, truncate or edit other than the first read", () => {
  assert.match(code, /BEFORE UPDATE OR DELETE ON notifications_notifications/);
  assert.match(code, /BEFORE TRUNCATE ON notifications_notifications/);
  assert.match(
    code,
    /OLD\.read_at IS NOT NULL AND NEW\.read_at IS DISTINCT FROM OLD\.read_at/,
  );
  const grants = sql.split("\n").filter((line) => /^\s*GRANT\b/i.test(line));
  assert.deepEqual(
    grants.map((line) => line.trim()),
    ["GRANT SELECT, INSERT, UPDATE ON notifications_notifications TO bus_app;"],
  );
  assert.match(
    code,
    /REVOKE DELETE, TRUNCATE ON notifications_notifications FROM bus_app/,
  );
});

test("own-notification capabilities go to the five baseline roles only", () => {
  assert.match(code, /'view-own-notifications'/);
  assert.match(code, /'update-own-notifications'/);
  assert.match(
    code,
    /r\.role_key IN \('admin', 'administrative_staff', 'transportation_manager', 'driver', 'applicant'\)/,
  );
  assert.doesNotMatch(code, /passenger/);
});
