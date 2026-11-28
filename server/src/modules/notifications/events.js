// Event handling for Notifications. This module imports no other domain module
// (ADR-009): anything that lives in Identity & Access, Drivers or Fleet reaches it
// through ports configured by the API layer (server/src/config/notifications.js).
import { createNotificationsBestEffort } from "./service.js";
import { EVENT_TYPES } from "./templates.js";

// Fixed recipient rule for license and maintenance alerts.
export const ALERT_RECIPIENT_ROLES = Object.freeze([
  "admin",
  "transportation_manager",
]);

const PORT_NAMES = Object.freeze([
  "resolveDriverAccountId", // (driverId) -> account id string | null
  "listAccountIdsByRoles", // (roleKeys) -> account id strings (active accounts only)
  "listLicenseAlerts", // () -> [{ driverId, fullName, licenseExpiryDate, state }]
  "listMaintenanceDueAlerts", // () -> [{ recordId, busNumber, maintenanceType, nextServiceDate, status }]
]);

let ports = {};

export function configureNotificationPorts(next) {
  for (const [name, fn] of Object.entries(next ?? {})) {
    if (!PORT_NAMES.includes(name))
      throw new Error(`Unknown notification port: ${name}`);
    if (typeof fn !== "function")
      throw new TypeError(`Notification port ${name} must be a function.`);
  }
  ports = { ...ports, ...next };
}

export function resetNotificationPorts() {
  ports = {};
}

function port(name) {
  if (typeof ports[name] !== "function")
    throw new Error(`NOTIFICATION_PORT_MISSING:${name}`);
  return ports[name];
}

function warn(context, error) {
  console.warn(`Notification ${context} failed:`, error?.message);
}

const SCHEDULE_EVENT_TYPES = Object.freeze({
  "schedule.assigned": EVENT_TYPES.SCHEDULE_ASSIGNED,
  "schedule.changed": EVENT_TYPES.SCHEDULE_CHANGED,
  "schedule.cancelled": EVENT_TYPES.SCHEDULE_CANCELLED,
  "schedule.replacement_assigned": EVENT_TYPES.SCHEDULE_REPLACEMENT_ASSIGNED,
});

const emptySummary = () => ({ created: 0, duplicates: 0, failed: 0 });

// Plugged into Scheduling's notification seam. The event's driverId is a driver
// RECORD id, so it is first converted to the linked login account. The assigned
// driver (the new driver for a replacement) is the only recipient. Never throws.
export async function handleScheduleEvent(event) {
  try {
    const eventType = SCHEDULE_EVENT_TYPES[event?.type];
    if (!eventType) return emptySummary();
    const accountId = await port("resolveDriverAccountId")(
      String(event.driverId),
    );
    if (!accountId) return emptySummary(); // driver has no login account: nobody to notify
    return await createNotificationsBestEffort([
      {
        recipientId: accountId,
        eventType,
        entityId: event.scheduleId,
        data: { scheduleId: event.scheduleId },
        dedupeKey: null,
      },
    ]);
  } catch (error) {
    warn("for schedule event", error);
    return { ...emptySummary(), failed: 1 };
  }
}

// Called by Recruitment after its transaction has committed. The applicant id is
// the account id (recruitment_applications.applicant_id). One notification per
// application and status, so a repeat is ignored. Never throws.
export async function notifyApplicantStatusChange({
  applicantId,
  applicationId,
  status,
}) {
  return createNotificationsBestEffort([
    {
      recipientId: applicantId,
      eventType: EVENT_TYPES.APPLICATION_STATUS_CHANGED,
      entityId: applicationId,
      data: { status },
      dedupeKey: `application:${applicationId}:${status}`,
    },
  ]);
}

async function runSource(bucket, portName, recipients, toEntry) {
  let alerts;
  try {
    alerts = await port(portName)();
  } catch (error) {
    warn(`source ${portName}`, error);
    bucket.failed += 1;
    return;
  }
  const entries = [];
  for (const alert of alerts) {
    for (const recipientId of recipients)
      entries.push({ recipientId, ...toEntry(alert) });
  }
  const result = await createNotificationsBestEffort(entries);
  bucket.created += result.created;
  bucket.duplicates += result.duplicates;
  bucket.failed += result.failed;
}

// Detects expiring/expired licenses and upcoming/overdue maintenance and notifies
// every active Admin and Transportation Manager. Repeat-safe: each alert has a
// dedupe key, so running it again (or from several instances) creates nothing new.
export async function runAlertCheck() {
  const summary = { licenses: emptySummary(), maintenance: emptySummary() };
  let recipients;
  try {
    recipients = await port("listAccountIdsByRoles")(ALERT_RECIPIENT_ROLES);
  } catch (error) {
    warn("recipient lookup", error);
    summary.licenses.failed += 1;
    summary.maintenance.failed += 1;
    return summary;
  }
  if (!recipients.length) return summary;

  await runSource(
    summary.licenses,
    "listLicenseAlerts",
    recipients,
    (alert) => ({
      eventType:
        alert.state === "expired"
          ? EVENT_TYPES.LICENSE_EXPIRED
          : EVENT_TYPES.LICENSE_EXPIRING,
      entityId: alert.driverId,
      data: { driverName: alert.fullName, expiryDate: alert.licenseExpiryDate },
      dedupeKey: `license:${alert.driverId}:${alert.state}:${alert.licenseExpiryDate}`,
    }),
  );
  await runSource(
    summary.maintenance,
    "listMaintenanceDueAlerts",
    recipients,
    (alert) => ({
      eventType:
        alert.status === "overdue"
          ? EVENT_TYPES.MAINTENANCE_OVERDUE
          : EVENT_TYPES.MAINTENANCE_UPCOMING,
      entityId: alert.recordId,
      data: {
        busNumber: alert.busNumber,
        maintenanceType: alert.maintenanceType,
        nextServiceDate: alert.nextServiceDate,
      },
      dedupeKey: `maintenance:${alert.recordId}:${alert.status}:${alert.nextServiceDate}`,
    }),
  );
  return summary;
}
