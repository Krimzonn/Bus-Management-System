import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  cancelSchedule, completeOwnTrip, completeTrip, createSchedule, getOwnSchedule, getSchedule,
  listOwnSchedules, listSchedules, startOwnTrip, startTrip, updateSchedule,
} from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewSchedules = requireCapability("view-schedules");
const manageSchedules = requireCapability("manage-schedules");
const viewOwnTrips = requireCapability("view-own-trips");
const operateOwnTrips = requireCapability("operate-own-trips");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

// A driver's own trips. These must stay above "/:id" so "mine" is not read as an id.
router.get("/mine", viewOwnTrips, async (req, res) =>
  success(res, await listOwnSchedules(req.user.id, req.query)));
router.get("/mine/:id", viewOwnTrips, async (req, res) =>
  success(res, await getOwnSchedule(req.user.id, req.params.id)));
router.post("/mine/:id/start", requireCsrf, operateOwnTrips, async (req, res) =>
  success(res, await startOwnTrip({ id: req.params.id, ...actor(req) })));
router.post("/mine/:id/complete", requireCsrf, operateOwnTrips, async (req, res) =>
  success(res, await completeOwnTrip({ id: req.params.id, ...actor(req) })));

router.get("/", viewSchedules, async (req, res) => success(res, await listSchedules(req.query)));
router.get("/:id", viewSchedules, async (req, res) => success(res, await getSchedule(req.params.id)));

router.post("/", requireCsrf, manageSchedules, async (req, res) =>
  success(res, await createSchedule({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageSchedules, async (req, res) =>
  success(res, await updateSchedule({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/start", requireCsrf, manageSchedules, async (req, res) =>
  success(res, await startTrip({ id: req.params.id, ...actor(req) })));

router.post("/:id/complete", requireCsrf, manageSchedules, async (req, res) =>
  success(res, await completeTrip({ id: req.params.id, ...actor(req) })));

router.post("/:id/cancel", requireCsrf, manageSchedules, async (req, res) =>
  success(res, await cancelSchedule({ id: req.params.id, ...actor(req) })));

export default router;
