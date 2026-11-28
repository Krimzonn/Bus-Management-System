// UI-only permission hints. The backend is the sole authority: every request is
// checked server-side, and a 403 is still handled gracefully.
//
// /auth/me currently returns only { id, email, role } (no capabilities), so
// these lists mirror the approved baselines in migrations 007_fleet_buses.sql,
// 008_routes.sql, 009_drivers.sql, 012_scheduling.sql, 013_recruitment.sql and
// 014_fleet_maintenance.sql. Replace this with real capabilities once the API
// exposes them.

export const CAPABILITIES = Object.freeze({
  APPLY_RECRUITMENT: "apply-recruitment",
  VIEW_RECRUITMENT: "view-recruitment",
  MANAGE_RECRUITMENT: "manage-recruitment",
  VIEW_BUSES: "view-buses",
  MANAGE_BUSES: "manage-buses",
  VIEW_ROUTES: "view-routes",
  MANAGE_ROUTES: "manage-routes",
  VIEW_DRIVERS: "view-drivers",
  MANAGE_DRIVERS: "manage-drivers",
  VIEW_SCHEDULES: "view-schedules",
  MANAGE_SCHEDULES: "manage-schedules",
  VIEW_OWN_TRIPS: "view-own-trips",
  OPERATE_OWN_TRIPS: "operate-own-trips",
  VIEW_MAINTENANCE: "view-maintenance",
  MANAGE_MAINTENANCE: "manage-maintenance",
  ARCHIVE_MAINTENANCE: "archive-maintenance",
});

const MANAGER_CAPABILITIES = [
  CAPABILITIES.VIEW_BUSES,
  CAPABILITIES.MANAGE_BUSES,
  CAPABILITIES.VIEW_ROUTES,
  CAPABILITIES.MANAGE_ROUTES,
  CAPABILITIES.VIEW_DRIVERS,
  CAPABILITIES.MANAGE_DRIVERS,
  CAPABILITIES.VIEW_SCHEDULES,
  CAPABILITIES.MANAGE_SCHEDULES,
];

// Admin, Administrative Staff and Transportation Manager view and manage
// (create/update) maintenance records; only Admin archives them.
const MAINTENANCE_CAPABILITIES = [
  CAPABILITIES.VIEW_MAINTENANCE,
  CAPABILITIES.MANAGE_MAINTENANCE,
];

const ROLE_CAPABILITIES = Object.freeze({
  admin: [
    ...MANAGER_CAPABILITIES,
    ...MAINTENANCE_CAPABILITIES,
    CAPABILITIES.ARCHIVE_MAINTENANCE,
    CAPABILITIES.VIEW_RECRUITMENT,
    CAPABILITIES.MANAGE_RECRUITMENT,
  ],
  transportation_manager: [
    ...MANAGER_CAPABILITIES,
    ...MAINTENANCE_CAPABILITIES,
    CAPABILITIES.VIEW_RECRUITMENT,
  ],
  applicant: [CAPABILITIES.APPLY_RECRUITMENT],
  administrative_staff: [
    CAPABILITIES.VIEW_BUSES,
    CAPABILITIES.VIEW_ROUTES,
    CAPABILITIES.VIEW_DRIVERS,
    CAPABILITIES.VIEW_SCHEDULES,
    ...MAINTENANCE_CAPABILITIES,
  ],
  driver: [CAPABILITIES.VIEW_OWN_TRIPS, CAPABILITIES.OPERATE_OWN_TRIPS],
});

export function can(user, capability) {
  const role = user?.role;
  if (typeof role !== "string" || !Object.hasOwn(ROLE_CAPABILITIES, role)) {
    return false;
  }
  return ROLE_CAPABILITIES[role].includes(capability);
}