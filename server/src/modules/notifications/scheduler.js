// Minimal in-process periodic runner for the alert check. Several instances may run
// it at once: the database dedupe index keeps the result correct. A run never
// overlaps the previous one in the same process, and a failed run only logs.
export function startAlertScheduler({ run, intervalMs, runOnStart = true }) {
  if (typeof run !== "function")
    throw new TypeError("startAlertScheduler requires a run function.");
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError(
      "startAlertScheduler requires a positive integer intervalMs.",
    );
  }
  let running = false;

  async function tick() {
    if (running) return false;
    running = true;
    try {
      await run();
    } catch (error) {
      console.warn("Notification alert check failed:", error?.message);
    } finally {
      running = false;
    }
    return true;
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.(); // never keeps the process alive
  if (runOnStart) void tick();
  return { tick, stop: () => clearInterval(timer) };
}
