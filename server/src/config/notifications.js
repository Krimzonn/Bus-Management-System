// Composition root for Notifications (ADR-009). This is API-layer wiring: it hands
// Notifications the read-only functions it needs from Identity & Access, Drivers
// and Fleet, and plugs Notifications into Scheduling's notification seam.
// Notifications itself imports none of those modules.
import { listActiveAccountIdsByRoles } from "../modules/auth/index.js";
import {
  getAccountIdForDriver,
  listLicenseAlerts,
} from "../modules/drivers/index.js";
import { listMaintenanceDueAlerts } from "../modules/fleet/index.js";
import {
  configureNotificationPorts,
  handleScheduleEvent,
  runAlertCheck,
  startAlertScheduler,
} from "../modules/notifications/index.js";
import { setScheduleNotifier } from "../modules/scheduling/index.js";

const DEFAULT_INTERVAL_MINUTES = 60;

export function wireNotifications() {
  configureNotificationPorts({
    resolveDriverAccountId: (driverId) => getAccountIdForDriver(driverId),
    listAccountIdsByRoles: (roleKeys) => listActiveAccountIdsByRoles(roleKeys),
    listLicenseAlerts: () => listLicenseAlerts(),
    listMaintenanceDueAlerts: () => listMaintenanceDueAlerts(),
  });
  setScheduleNotifier(handleScheduleEvent);
}

// Started by server.js only (never by tests that import the app).
export function startNotificationJobs() {
  const minutes = Number(
    process.env.NOTIFICATION_ALERT_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES,
  );
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error(
      "NOTIFICATION_ALERT_INTERVAL_MINUTES must be a whole number from 1 to 1440.",
    );
  }
  return startAlertScheduler({
    run: runAlertCheck,
    intervalMs: minutes * 60 * 1000,
  });
}
