import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  archiveDriver, createDriver, getDriver, listDrivers, listLicenseExpiry, setDriverStatus, updateDriver,
} from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewDrivers = requireCapability("view-drivers");
const manageDrivers = requireCapability("manage-drivers");

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

export default router;
