import test from "node:test";
import assert from "node:assert/strict";
import { startAlertScheduler } from "./scheduler.js";

test("runs once on start, never overlaps itself and survives a failing run", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  let release;
  const scheduler = startAlertScheduler({
    intervalMs: 3_600_000,
    run: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  t.after(() => scheduler.stop());
  assert.equal(calls, 1);
  assert.equal(await scheduler.tick(), false); // still running: skipped
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await scheduler.tick(), true);
  assert.equal(calls, 2);
  release();
});

test("a failing run only logs", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const scheduler = startAlertScheduler({
    intervalMs: 3_600_000,
    runOnStart: false,
    run: async () => {
      throw new Error("boom");
    },
  });
  t.after(() => scheduler.stop());
  assert.equal(await scheduler.tick(), true);
  assert.equal(warn.mock.callCount(), 1);
});

test("invalid options are rejected", () => {
  assert.throws(
    () => startAlertScheduler({ run: "x", intervalMs: 1000 }),
    TypeError,
  );
  assert.throws(
    () => startAlertScheduler({ run: async () => {}, intervalMs: 0 }),
    TypeError,
  );
});
