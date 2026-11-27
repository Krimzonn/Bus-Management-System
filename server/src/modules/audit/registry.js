// Supported audit events. This does not resolve the broader D-11 policy.
export const ACTIONS = Object.freeze({
  "account.created": { entity: "account", fields: ["email", "role", "isActive"] },
  "account.email_updated": { entity: "account", fields: ["email"] },
  "account.role_changed": { entity: "account", fields: ["role"] },
  "account.activated": { entity: "account", fields: ["isActive"] },
  "account.deactivated": { entity: "account", fields: ["isActive"] },
  "auth.login_succeeded": { entity: "auth", fields: ["email"] },
  "auth.logout": { entity: "auth", fields: ["email"] },
  "bus.created": {
    entity: "bus",
    fields: ["busNumber", "seatingCapacity", "requiredLicenseCategory", "status", "isArchived"],
  },
  "bus.updated": { entity: "bus", fields: ["seatingCapacity", "requiredLicenseCategory"] },
  "bus.status_changed": { entity: "bus", fields: ["status"] },
  "bus.archived": { entity: "bus", fields: ["isArchived"] },
  "route.created": {
    entity: "route",
    fields: ["routeCode", "name", "origin", "destination", "status", "isArchived"],
  },
  "route.updated": { entity: "route", fields: ["name", "origin", "destination"] },
  "route.status_changed": { entity: "route", fields: ["status"] },
  "route.archived": { entity: "route", fields: ["isArchived"] },
  "driver.created": {
    entity: "driver",
    fields: ["fullName", "licenseNumber", "licenseCategory", "licenseExpiryDate", "status", "isArchived"],
  },
  "driver.updated": { entity: "driver", fields: ["fullName"] },
  "driver.license_updated": {
    entity: "driver",
    fields: ["licenseNumber", "licenseCategory", "licenseExpiryDate"],
  },
  "driver.status_changed": { entity: "driver", fields: ["status"] },
  "driver.archived": { entity: "driver", fields: ["isArchived"] },
});
export const ENTITY_TYPES = Object.freeze(["account", "auth", "bus", "route", "driver"]);