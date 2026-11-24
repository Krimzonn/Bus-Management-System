/**
 * Central capability authorization policy.
 *
 * The role-to-capability matrix is supplied as configuration.
 * No role permissions are assumed or hardcoded here.
 */

export function hasCapability(role, capability, roleCapabilities) {
  if (
    typeof role !== "string" ||
    typeof capability !== "string" ||
    !roleCapabilities ||
    typeof roleCapabilities !== "object" ||
    Array.isArray(roleCapabilities)
  ) {
    return false;
  }

  const capabilities = roleCapabilities[role];

  if (!Array.isArray(capabilities)) {
    return false;
  }

  return capabilities.includes(capability);
}
