// The backend owns notification text (AGENTS.md section 6.10). Callers pass an
// event type and data, never prewritten text. English only for now (D-15).

export const EVENT_TYPES = Object.freeze({
  SCHEDULE_ASSIGNED: "schedule.assigned",
  SCHEDULE_CHANGED: "schedule.changed",
  SCHEDULE_CANCELLED: "schedule.cancelled",
  SCHEDULE_REPLACEMENT_ASSIGNED: "schedule.replacement_assigned",
  LICENSE_EXPIRING: "license.expiring",
  LICENSE_EXPIRED: "license.expired",
  MAINTENANCE_UPCOMING: "maintenance.upcoming",
  MAINTENANCE_OVERDUE: "maintenance.overdue",
  APPLICATION_STATUS_CHANGED: "application.status_changed",
});

const APPLICATION_STATUS_LABELS = Object.freeze({
  submitted: "Application Submitted",
  under_review: "Under Review",
  test_interview: "Test/Interview",
  selected: "Selected",
  rejected: "Rejected",
});

// Removes control characters and keeps text inside the column limits.
function clip(value, max) {
  const text = String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Returns { title, message, entityType } or null for an unknown event type.
export function renderNotification(eventType, data = {}) {
  const d = data ?? {};
  switch (eventType) {
    case EVENT_TYPES.SCHEDULE_ASSIGNED:
      return {
        title: "New trip assigned",
        message: `Trip #${clip(d.scheduleId, 20)} has been assigned to you.`,
        entityType: "schedule",
      };
    case EVENT_TYPES.SCHEDULE_CHANGED:
      return {
        title: "Trip updated",
        message: `Trip #${clip(d.scheduleId, 20)} assigned to you has been changed. Open your trips to see the latest details.`,
        entityType: "schedule",
      };
    case EVENT_TYPES.SCHEDULE_CANCELLED:
      return {
        title: "Trip cancelled",
        message: `Trip #${clip(d.scheduleId, 20)} has been cancelled.`,
        entityType: "schedule",
      };
    case EVENT_TYPES.SCHEDULE_REPLACEMENT_ASSIGNED:
      return {
        title: "Trip assigned as replacement",
        message: `You have been assigned to trip #${clip(d.scheduleId, 20)} as a replacement driver.`,
        entityType: "schedule",
      };
    case EVENT_TYPES.LICENSE_EXPIRING:
      return {
        title: "Driver license expiring soon",
        message: `The license of ${clip(d.driverName, 100)} expires on ${clip(d.expiryDate, 10)}.`,
        entityType: "driver",
      };
    case EVENT_TYPES.LICENSE_EXPIRED:
      return {
        title: "Driver license expired",
        message: `The license of ${clip(d.driverName, 100)} expired on ${clip(d.expiryDate, 10)}.`,
        entityType: "driver",
      };
    case EVENT_TYPES.MAINTENANCE_UPCOMING:
      return {
        title: "Maintenance due soon",
        message: `Bus ${clip(d.busNumber, 30)}: ${clip(d.maintenanceType, 100)} is due on ${clip(d.nextServiceDate, 10)}.`,
        entityType: "maintenance",
      };
    case EVENT_TYPES.MAINTENANCE_OVERDUE:
      return {
        title: "Maintenance overdue",
        message: `Bus ${clip(d.busNumber, 30)}: ${clip(d.maintenanceType, 100)} was due on ${clip(d.nextServiceDate, 10)}.`,
        entityType: "maintenance",
      };
    case EVENT_TYPES.APPLICATION_STATUS_CHANGED:
      return {
        title: "Application status updated",
        message: `Your application status is now ${APPLICATION_STATUS_LABELS[d.status] ?? clip(d.status, 40)}.`,
        entityType: "application",
      };
    default:
      return null;
  }
}
