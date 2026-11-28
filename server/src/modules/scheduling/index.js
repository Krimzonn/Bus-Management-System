// Public entry point of the Scheduling module (AGENTS.md section 5.3).
// Only the notification seam is exposed so far: no other module may write
// schedules (ADR-004).
export { setScheduleNotifier } from "./notification-seam.js";
