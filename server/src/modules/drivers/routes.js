import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import { userHasCapability } from "../auth/index.js";
import {
  archiveDriver, createDriver, getDriver, getDriverAccountLink, listDrivers, listLicenseExpiry,
  setDriverAccountLink, setDriverStatus, updateDriver,
} from "./service.js";
import { driverError, parseAccountLinkInput } from "./validation.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewDrivers = requireCapability("view-drivers");
const manageDrivers = requireCapability("manage-drivers");
// Linking a login grants access to trips, so it stays with account administrators.
const manageAccounts = requireCapability("manage-internal-accounts");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

router.get("/", viewDrivers, async (req, res) => success(res, await listDrivers(req.query)));
// Must stay above "/:id" so "license-expiry" is not read as an id.
router.get("/license-expiry", viewDrivers, async (req, res) =>
  success(res, await listLicenseExpiry(req.query)));
router.get("/:id", viewDrivers, async (req, res) => success(res, await getDriver(req.params.id)));

router.post("/", requireCsrf, manageDrivers, async (req, res) =>
  success(res, await createDriver({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageDrivers, async (req, res) =>
  success(res, await updateDriver({ id: req.params.id, input: req.body, ...actor(req) })));

router.patch("/:id/status", requireCsrf, manageDrivers, async (req, res) =>
  success(res, await setDriverStatus({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/archive", requireCsrf, manageDrivers, async (req, res) =>
  success(res, await archiveDriver({ id: req.params.id, ...actor(req) })));

router.get("/:id/account", manageAccounts, async (req, res) =>
  success(res, await getDriverAccountLink(req.params.id)));

router.put("/:id/account", requireCsrf, manageAccounts, async (req, res) => {
  const userId = parseAccountLinkInput(req.body);
  // Asked of Identity & Access here so that Drivers does not depend on it.
  if (userId !== null && !(await userHasCapability(userId, "view-own-trips"))) {
    throw driverError("ACCOUNT_NOT_ELIGIBLE_FOR_DRIVER_LINK", 409);
  }
  return success(res, await setDriverAccountLink({ id: req.params.id, userId, ...actor(req) }));
});

export default router;
