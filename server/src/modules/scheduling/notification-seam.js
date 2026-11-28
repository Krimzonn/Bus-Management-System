// Integration seam for the future Notifications slice. Nothing is sent today.
//
// Scheduling calls publishScheduleEvent only after its transaction has
// committed, and a failing or slow notifier never affects the business
// operation (ADR-005). The Notifications slice plugs in with
// setScheduleNotifier, or by calling its public interface from the default
// below; Notifications must not import Scheduling internals.
//
// Events: { type: "schedule.assigned" | "schedule.changed" | "schedule.cancelled",
//           scheduleId, driverId, previousDriverId }
// previousDriverId is set only when a change moved the trip to another driver.
//
// Delivery is not durable yet: ADR-005 expects Notifications to persist a
// request before sending, which that slice must add.
const noop = () => {};
let notifier = noop;

export function setScheduleNotifier(handler = noop) {
  if (typeof handler !== "function") throw new TypeError("setScheduleNotifier requires a function.");
  notifier = handler;
}

function report(error) {
  console.warn("Schedule notification failed:", error?.message);
}

export function publishScheduleEvent(event) {
  try {
    // Deliberately not awaited.
    Promise.resolve(notifier(Object.freeze({ ...event }))).catch(report);
  } catch (error) {
    report(error);
  }
}
