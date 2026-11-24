import { isCapabilityAllowed } from "../modules/auth/policy.js";
import { loadRoleCapabilities } from "../modules/auth/permissions.js";

export function requireCapability(
  capability,
  permissionsLoader = loadRoleCapabilities,
) {
  return async (req, _res, next) => {
    if (!req.user || typeof req.user !== "object") {
      const error = new Error("Authentication required.");
      error.status = 401;
      error.code = "AUTHENTICATION_REQUIRED";
      return next(error);
    }

    try {
      const roleCapabilities = await permissionsLoader();

      const allowed = isCapabilityAllowed({
        role: req.user.role,
        capability,
        roleCapabilities,
      });

      if (!allowed) {
        const error = new Error("Permission denied.");
        error.status = 403;
        error.code = "INSUFFICIENT_PERMISSION";
        return next(error);
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
