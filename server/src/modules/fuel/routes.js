import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  archiveFuelRecord, createFuelRecord, getBusFuelHistory, getFuelRecord, getFuelSummary,
  listFuelRecords, updateFuelRecord,
} from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewFuel = requireCapability("view-fuel");
const manageFuel = requireCapability("manage-fuel");
const archiveFuel = requireCapability("archive-fuel");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

router.get("/", viewFuel, async (req, res) => success(res, await listFuelRecords(req.query)));
// These fixed paths must stay above "/:id" so they are not read as ids.
router.get("/summary", viewFuel, async (req, res) => success(res, await getFuelSummary(req.query)));
router.get("/bus/:busId", viewFuel, async (req, res) =>
  success(res, await getBusFuelHistory(req.params.busId, req.query)));
router.get("/:id", viewFuel, async (req, res) => success(res, await getFuelRecord(req.params.id)));

router.post("/", requireCsrf, manageFuel, async (req, res) =>
  success(res, await createFuelRecord({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageFuel, async (req, res) =>
  success(res, await updateFuelRecord({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/archive", requireCsrf, archiveFuel, async (req, res) =>
  success(res, await archiveFuelRecord({ id: req.params.id, ...actor(req) })));

export default router;