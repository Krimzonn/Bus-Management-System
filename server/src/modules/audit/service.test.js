import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import { listAudit } from "./service.js";

test("uses bound filters and deterministic newest-first pagination", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...values) => { args = values; return { rows: [] }; });
  const result = await listAudit({
    actorId: "12", action: "account.role_changed", entityType: "account",
    from: "2026-11-01T00:00:00Z", to: "2026-11-02T00:00:00+00:00",
    page: "2", limit: "20",
  });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 20);
  assert.match(args[0], /ORDER BY created_at DESC, id DESC/);
  assert.match(args[0], /actor_id = \$1/);
  assert.match(args[0], /LIMIT \$6 OFFSET \$7/);
  assert.deepEqual(args[1], [
    "12", "account.role_changed", "account",
    "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z", 20, 20,
  ]);
});

test("rejects invalid filters and pagination", async () => {
  await assert.rejects(listAudit({ action: "account.password_changed" }), { code: "INVALID_AUDIT_FILTER" });
  await assert.rejects(listAudit({ from: "yesterday" }), { code: "INVALID_AUDIT_FILTER" });
  await assert.rejects(listAudit({ page: "0" }), { code: "INVALID_PAGINATION" });
  await assert.rejects(listAudit({ limit: "101" }), { code: "INVALID_PAGINATION" });
  await assert.rejects(listAudit({ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" }), { code: "INVALID_AUDIT_FILTER" });
});
