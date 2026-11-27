import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  archiveRoute, createRoute, getRoute, listRoutes, listSelectableRoutes, setRouteStatus, updateRoute,
} from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
const router = Router();
const viewRoutes = requireCapability("view-routes");
const manageRoutes = requireCapability("manage-routes");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function actor(req) {
  return { actorId: req.user.id, actorEmail: req.user.email };
}

router.use(requireAuthentication);

router.get("/", viewRoutes, async (req, res) => success(res, await listRoutes(req.query)));
// Must stay above "/:id" so "selectable" is not read as an id.
router.get("/selectable", viewRoutes, async (req, res) => success(res, await listSelectableRoutes(req.query)));
router.get("/:id", viewRoutes, async (req, res) => success(res, await getRoute(req.params.id)));

router.post("/", requireCsrf, manageRoutes, async (req, res) =>
  success(res, await createRoute({ input: req.body, ...actor(req) }), 201));

router.put("/:id", requireCsrf, manageRoutes, async (req, res) =>
  success(res, await updateRoute({ id: req.params.id, input: req.body, ...actor(req) })));

router.patch("/:id/status", requireCsrf, manageRoutes, async (req, res) =>
  success(res, await setRouteStatus({ id: req.params.id, input: req.body, ...actor(req) })));

router.post("/:id/archive", requireCsrf, manageRoutes, async (req, res) =>
  success(res, await archiveRoute({ id: req.params.id, ...actor(req) })));

export default router;