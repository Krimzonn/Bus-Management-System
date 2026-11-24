// Slice 3's supported events. This does not resolve the broader D-11 policy.
export const ACTIONS = Object.freeze({
  "account.created": { entity: "account", fields: ["email", "role", "isActive"] },
  "account.email_updated": { entity: "account", fields: ["email"] },
  "account.role_changed": { entity: "account", fields: ["role"] },
  "account.activated": { entity: "account", fields: ["isActive"] },
  "account.deactivated": { entity: "account", fields: ["isActive"] },
  "auth.login_succeeded": { entity: "auth", fields: ["email"] },
  "auth.logout": { entity: "auth", fields: ["email"] },
});
export const ENTITY_TYPES = Object.freeze(["account", "auth"]);
