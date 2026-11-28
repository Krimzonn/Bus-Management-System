import test from "node:test";
import assert from "node:assert/strict";
import {
  parseListFilters,
  parseNotificationId,
  parseRecipientId,
} from "./validation.js";

test("notification id validation", () => {
  assert.equal(parseNotificationId("12"), "12");
  for (const bad of [
    "0",
    "-1",
    "1.5",
    "abc",
    "",
    3,
    null,
    undefined,
    "1".repeat(19),
  ]) {
    assert.throws(() => parseNotificationId(bad), {
      code: "INVALID_NOTIFICATION_ID",
      status: 400,
    });
  }
});

test("the recipient must be a positive account id", () => {
  assert.equal(parseRecipientId("7"), "7");
  assert.equal(parseRecipientId(7), "7");
  for (const bad of [undefined, null, "", "0", "abc", {}]) {
    assert.throws(() => parseRecipientId(bad), {
      code: "INVALID_RECIPIENT",
      status: 500,
    });
  }
});

test("list filters apply defaults and accept only unread, page and limit", () => {
  assert.deepEqual(parseListFilters({}), { unread: false, page: 1, limit: 25 });
  assert.deepEqual(
    parseListFilters({ unread: "true", page: "2", limit: "100" }),
    { unread: true, page: 2, limit: 100 },
  );
  assert.equal(parseListFilters({ unread: "false" }).unread, false);
});

test("list filters reject bad values and any client-supplied recipient", () => {
  for (const query of [
    { unread: "yes" },
    { unread: ["true"] },
    { recipientId: "1" },
    { userId: "1" },
    { q: "x" },
  ]) {
    assert.throws(() => parseListFilters(query), {
      code: "INVALID_NOTIFICATION_FILTER",
      status: 400,
    });
  }
  for (const query of [
    { page: "0" },
    { limit: "101" },
    { page: "10001" },
    { limit: "x" },
    { page: "1.5" },
  ]) {
    assert.throws(() => parseListFilters(query), {
      code: "INVALID_PAGINATION",
      status: 400,
    });
  }
  assert.throws(() => parseListFilters([]), {
    code: "INVALID_NOTIFICATION_FILTER",
  });
});
