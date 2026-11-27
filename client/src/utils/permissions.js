// UI-only permission hints. The backend is the sole authority: every request is
// checked server-side, and a 403 is still handled gracefully.
//
// /auth/me currently returns only { id, email, role } (no capabilities), so
// these lists mirror the approved baselines in migrations 007_fleet_buses.sql,
// 008_routes.sql and 009_drivers.sql. Replace this with real capabilities once
// the API exposes them.

export const CAPABILITIES = Object.freeze({
  VIEW_BUSES: "view-buses",
  MANAGE_BUSES: "manage-buses",
  VIEW_ROUTES: "view-routes",
  MANAGE_ROUTES: "manage-routes",
  VIEW_DRIVERS: "view-drivers",
  MANAGE_DRIVERS: "manage-drivers",
});

const MANAGER_CAPABILITIES = [
  CAPABILITIES.VIEW_BUSES,
  CAPABILITIES.MANAGE_BUSES,
  CAPABILITIES.VIEW_ROUTES,
  CAPABILITIES.MANAGE_ROUTES,
  CAPABILITIES.VIEW_DRIVERS,
  CAPABILITIES.MANAGE_DRIVERS,
];

const ROLE_CAPABILITIES = Object.freeze({
  admin: MANAGER_CAPABILITIES,
  transportation_manager: MANAGER_CAPABILITIES,
  administrative_staff: [
    CAPABILITIES.VIEW_BUSES,
    CAPABILITIES.VIEW_ROUTES,
    CAPABILITIES.VIEW_DRIVERS,
  ],
});

export function can(user, capability) {
  const role = user?.role;
  if (typeof role !== "string" || !Object.hasOwn(ROLE_CAPABILITIES, role)) {
    return false;
  }
  return ROLE_CAPABILITIES[role].includes(capability);
}