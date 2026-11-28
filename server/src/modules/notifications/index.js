// Public entry point of the Notifications module (AGENTS.md section 5.3).
// Other modules import only from here.
export {
  countUnreadNotifications,
  createNotificationsBestEffort,
  listNotifications,
  markNotificationRead,
} from "./service.js";
export {
  ALERT_RECIPIENT_ROLES,
  configureNotificationPorts,
  handleScheduleEvent,
  notifyApplicantStatusChange,
  resetNotificationPorts,
  runAlertCheck,
} from "./events.js";
export { startAlertScheduler } from "./scheduler.js";
export { EVENT_TYPES } from "./templates.js";
