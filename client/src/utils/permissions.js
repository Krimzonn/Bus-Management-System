// UI-only permission hints. The backend is the sole authority: every request is
// checked server-side, and a 403 is still handled gracefully.
//
// /auth/me currently returns only { id, email, role } (no capabilities), so
// these lists mirror the approved baselines in migrations 007_fleet_buses.sql
// and 008_routes.sql. Replace this with real capabilities once the API exposes them.

export const CAPABILITIES = Object.freeze({
  VIEW_BUSES: "view-buses",
  MANAGE_BUSES: "manage-buses",
  VIEW_ROUTES: "view-routes",
  MANAGE_ROUTES: "manage-routes",
});

const ROLE_CAPABILITIES = Object.freeze({
  admin: [
    CAPABILITIES.VIEW_BUSES,
    CAPABILITIES.MANAGE_BUSES,
    CAPABILITIES.VIEW_ROUTES,
    CAPABILITIES.MANAGE_ROUTES,
  ],
  transportation_manager: [
    CAPABILITIES.VIEW_BUSES,
    CAPABILITIES.MANAGE_BUSES,
    CAPABILITIES.VIEW_ROUTES,
    CAPABILITIES.MANAGE_ROUTES,
  ],
  administrative_staff: [CAPABILITIES.VIEW_BUSES, CAPABILITIES.VIEW_ROUTES],
});

export function can(user, capability) {
  const role = user?.role;
  if (typeof role !== "string" || !Object.hasOwn(ROLE_CAPABILITIES, role)) {
    return false;
  }
  return ROLE_CAPABILITIES[role].includes(capability);
}