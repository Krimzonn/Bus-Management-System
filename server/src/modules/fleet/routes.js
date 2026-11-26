import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import { archiveBus, createBus, getBus, listBuses, setBusStatus, updateBus } from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewBuses = requireCapability("view-buses");
const manageBuses = requireCapability("manage-buses");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

router.get("/", viewBuses, async (req, res) => success(res, await listBuses(req.query)));
router.get("/:id", viewBuses, async (req, res) => success(res, await getBus(req.params.id)));

router.post("/", requireCsrf, manageBuses, async (req, res) =>
  success(res, await createBus({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageBuses, async (req, res) =>
  success(res, await updateBus({ id: req.params.id, input: req.body, ...actor(req) })));

router.patch("/:id/status", requireCsrf, manageBuses, async (req, res) =>
  success(res, await setBusStatus({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/archive", requireCsrf, manageBuses, async (req, res) =>
  success(res, await archiveBus({ id: req.params.id, ...actor(req) })));

export default router;