import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  archiveMaintenance, createMaintenance, getBusMaintenanceHistory, getMaintenance,
  listMaintenance, listOverdueMaintenance, listUpcomingMaintenance, updateMaintenance,
} from "./maintenance-service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewMaintenance = requireCapability("view-maintenance");
const manageMaintenance = requireCapability("manage-maintenance");
const archiveRecords = requireCapability("archive-maintenance");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

router.get("/", viewMaintenance, async (req, res) => success(res, await listMaintenance(req.query)));
// These fixed paths must stay above "/:id" so they are not read as ids.
router.get("/upcoming", viewMaintenance, async (req, res) =>
  success(res, await listUpcomingMaintenance(req.query)));
router.get("/overdue", viewMaintenance, async (req, res) =>
  success(res, await listOverdueMaintenance(req.query)));
router.get("/bus/:busId", viewMaintenance, async (req, res) =>
  success(res, await getBusMaintenanceHistory(req.params.busId, req.query)));
router.get("/:id", viewMaintenance, async (req, res) => success(res, await getMaintenance(req.params.id)));

router.post("/", requireCsrf, manageMaintenance, async (req, res) =>
  success(res, await createMaintenance({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageMaintenance, async (req, res) =>
  success(res, await updateMaintenance({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/archive", requireCsrf, archiveRecords, async (req, res) =>
  success(res, await archiveMaintenance({ id: req.params.id, ...actor(req) })));

export default router;