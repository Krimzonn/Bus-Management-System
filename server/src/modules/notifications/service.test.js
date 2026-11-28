import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  countUnreadNotifications,
  createNotificationsBestEffort,
  listNotifications,
  markNotificationRead,
} from "./service.js";
import { EVENT_TYPES } from "./templates.js";

function row(overrides = {}) {
  return {
    id: "5",
    recipient_id: "7",
    event_type: "schedule.assigned",
    title: "New trip assigned",
    message: "Trip #9 has been assigned to you.",
    entity_type: "schedule",
    entity_id: "9",
    read_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

test("list is scoped to the recipient, newest first, with bound parameters", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => {
    args = a;
    return { rows: [{ ...row(), total_count: "31" }] };
  });
  const result = await listNotifications("7", {
    unread: "true",
    page: "2",
    limit: "10",
  });
  assert.match(args[0], /recipient_id = \$1/);
  assert.match(args[0], /read_at IS NULL/);
  assert.match(args[0], /ORDER BY created_at DESC, id DESC/);
  assert.match(args[0], /LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(args[1], ["7", 10, 10]);
  assert.equal(result.total, 31);
  assert.equal(result.page, 2);
  assert.equal(result.items[0].isRead, false);
  assert.equal("recipient_id" in result.items[0], false);
  assert.equal("recipientId" in result.items[0], false);
});

test("list without unread adds no read filter; read rows are reported as read", async (t) => {
  let sql;
  const readAt = new Date();
  t.mock.method(pool, "query", async (text) => {
    sql = text;
    return { rows: [{ ...row({ read_at: readAt }), total_count: "1" }] };
  });
  const result = await listNotifications("7", {});
  assert.doesNotMatch(sql, /read_at IS NULL/);
  assert.equal(result.items[0].isRead, true);
  assert.equal(result.items[0].readAt, readAt);
});

test("a client-supplied recipient is rejected before any query", async (t) => {
  const query = t.mock.method(pool, "query", async () =>
    assert.fail("must not query"),
  );
  await assert.rejects(listNotifications("7", { recipientId: "8" }), {
    code: "INVALID_NOTIFICATION_FILTER",
  });
  await assert.rejects(listNotifications(undefined, {}), {
    code: "INVALID_RECIPIENT",
  });
  assert.equal(query.mock.callCount(), 0);
});

test("unread count is scoped to the recipient", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => {
    args = a;
    return { rows: [{ count: 3 }] };
  });
  assert.deepEqual(await countUnreadNotifications("7"), { count: 3 });
  assert.match(args[0], /recipient_id = \$1 AND read_at IS NULL/);
  assert.deepEqual(args[1], ["7"]);
});

test("mark-read is limited to the owner and keeps the first read time", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => {
    args = a;
    return { rows: [row({ read_at: new Date() })] };
  });
  const result = await markNotificationRead("7", "5");
  assert.match(args[0], /COALESCE\(read_at, CURRENT_TIMESTAMP\)/);
  assert.match(args[0], /id = \$1 AND recipient_id = \$2/);
  assert.deepEqual(args[1], ["5", "7"]);
  assert.equal(result.isRead, true);
});

test("someone else's or a missing notification is a 404; a bad id is a 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  await assert.rejects(markNotificationRead("7", "5"), {
    code: "NOTIFICATION_NOT_FOUND",
    status: 404,
  });
  await assert.rejects(markNotificationRead("7", "abc"), {
    code: "INVALID_NOTIFICATION_ID",
    status: 400,
  });
});

const entry = (overrides = {}) => ({
  recipientId: "7",
  eventType: EVENT_TYPES.SCHEDULE_ASSIGNED,
  entityId: "9",
  data: { scheduleId: "9" },
  dedupeKey: null,
  ...overrides,
});

test("creation inserts rendered text and counts duplicates from ON CONFLICT", async (t) => {
  const calls = [];
  let conflict = false;
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    return { rows: conflict ? [] : [{ id: "1" }] };
  });
  assert.deepEqual(
    await createNotificationsBestEffort([entry({ dedupeKey: "k" })]),
    { created: 1, duplicates: 0, failed: 0 },
  );
  conflict = true;
  assert.deepEqual(
    await createNotificationsBestEffort([entry({ dedupeKey: "k" })]),
    { created: 0, duplicates: 1, failed: 0 },
  );
  assert.match(
    calls[0].sql,
    /ON CONFLICT \(recipient_id, dedupe_key\) WHERE dedupe_key IS NOT NULL DO NOTHING/,
  );
  assert.deepEqual(calls[0].values, [
    "7",
    "schedule.assigned",
    "New trip assigned",
    "Trip #9 has been assigned to you.",
    "schedule",
    "9",
    "k",
  ]);
});

test("a database failure never throws and does not stop the other entries", async (t) => {
  t.mock.method(console, "warn", () => {});
  let n = 0;
  t.mock.method(pool, "query", async () => {
    n += 1;
    if (n === 1) throw new Error("db down");
    return { rows: [{ id: "2" }] };
  });
  const result = await createNotificationsBestEffort([
    entry(),
    entry({ recipientId: "8" }),
  ]);
  assert.deepEqual(result, { created: 1, duplicates: 0, failed: 1 });
});

test("invalid entries are counted as failures, not thrown, and not inserted", async (t) => {
  t.mock.method(console, "warn", () => {});
  const query = t.mock.method(pool, "query", async () => ({
    rows: [{ id: "1" }],
  }));
  const result = await createNotificationsBestEffort([
    entry({ recipientId: "abc" }),
    entry({ eventType: "nope" }),
    entry({ dedupeKey: "x".repeat(201) }),
  ]);
  assert.deepEqual(result, { created: 0, duplicates: 0, failed: 3 });
  assert.equal(query.mock.callCount(), 0);
  assert.deepEqual(await createNotificationsBestEffort(undefined), {
    created: 0,
    duplicates: 0,
    failed: 0,
  });
});
