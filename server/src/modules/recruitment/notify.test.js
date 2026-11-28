import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { pool } from "../../database/db.js";
import { changeStatus } from "./service.js";

// Unit tests with a fake database. The full flow against PostgreSQL is in
// notifications.integration.test.js.
const user = { id: "7", email: "admin@example.com" };
const base = {
  id: "31",
  applicant_id: "12",
  applicant_email: "a@example.com",
  full_name: "Ali",
  experience: "x",
  status: "test_interview",
  interview_date: "2026-11-01",
  interview_notes: "ok",
  interview_outcome: "passed",
  decision_reason: null,
  driver_id: null,
};

function useClient(t, before) {
  const client = {
    calls: [],
    async query(sql) {
      this.calls.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [before] };
      if (sql.startsWith("UPDATE recruitment_applications"))
        return { rows: [{ ...before, status: "selected" }] };
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  return client;
}

test("a failing notification never undoes or fails the status change", async (t) => {
  t.mock.method(console, "warn", () => {});
  const client = useClient(t, base);
  const notificationInserts = [];
  t.mock.method(pool, "query", async (_sql, values) => {
    notificationInserts.push(values);
    throw new Error("notifications down");
  });

  const result = await changeStatus("31", { status: "selected" }, user);
  assert.equal(result.status, "selected");
  assert.equal(client.calls.at(-1), "COMMIT");
  assert.equal(client.calls.includes("ROLLBACK"), false);

  await tick();
  assert.equal(notificationInserts.length, 1);
  assert.equal(notificationInserts[0][0], "12"); // the applicant's account
  assert.equal(notificationInserts[0][1], "application.status_changed");
  assert.equal(notificationInserts[0][5], "31");
  assert.equal(notificationInserts[0][6], "application:31:selected");
});

test("a rejected status change creates no notification", async (t) => {
  const client = useClient(t, {
    ...base,
    status: "submitted",
    interview_outcome: null,
  });
  const query = t.mock.method(pool, "query", async () => ({
    rows: [{ id: "1" }],
  }));
  await assert.rejects(changeStatus("31", { status: "selected" }, user), {
    code: "INVALID_APPLICATION_TRANSITION",
  });
  assert.equal(client.calls.at(-1), "ROLLBACK");
  await tick();
  assert.equal(query.mock.callCount(), 0);
});
