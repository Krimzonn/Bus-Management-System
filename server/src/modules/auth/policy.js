/**
 * Central capability authorization policy.
 *
 * D-02: Role-to-capability assignments must come from an approved
 * configuration. Do not invent or hardcode role permissions here.
 *
 * @param {object} options
 * @param {string} options.role - The user's assigned role.
 * @param {string} options.capability - The required capability.
 * @param {object} options.roleCapabilities - Role-to-capability mapping.
 * @returns {boolean}
 */
export function isCapabilityAllowed({ role, capability, roleCapabilities }) {
  // Fail closed if required information is missing or invalid.
  if (
    typeof role !== "string" ||
    role.trim() === "" ||
    typeof capability !== "string" ||
    capability.trim() === "" ||
    !roleCapabilities ||
    typeof roleCapabilities !== "object" ||
    Array.isArray(roleCapabilities)
  ) {
    return false;
  }

  // An unconfigured role receives no permissions.
  if (!Object.prototype.hasOwnProperty.call(roleCapabilities, role)) {
    return false;
  }

  const assignedCapabilities = roleCapabilities[role];

  if (!Array.isArray(assignedCapabilities)) {
    return false;
  }

  return assignedCapabilities.includes(capability);
}
