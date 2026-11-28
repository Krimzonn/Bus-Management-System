import { Router } from "express";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import { requireCsrf } from "../../middleware/csrf.js";
import {
  listApplications,
  getApplication,
  submit,
  changeStatus,
  recordInterview,
  registerDriver,
} from "./service.js";
const router = Router();
const own = requireCapability("apply-recruitment"),
  view = requireCapability("view-recruitment"),
  manage = requireCapability("manage-recruitment");
const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });
router.use(requireAuthentication);
router.get("/own", own, async (req, res) =>
  ok(res, await listApplications(req.user.id)),
);
router.get("/own/:id", own, async (req, res) =>
  ok(res, await getApplication(req.params.id, req.user.id)),
);
router.post("/own", requireCsrf, own, async (req, res) =>
  ok(res, await submit(req.body, req.user), 201),
);
router.post("/own/:id/driver", requireCsrf, own, async (req, res) =>
  ok(res, await registerDriver(req.params.id, req.body, req.user), 201),
);
router.get("/", view, async (req, res) =>
  ok(res, await listApplications(null, req.query)),
);
router.get("/:id", view, async (req, res) =>
  ok(res, await getApplication(req.params.id)),
);
router.patch("/:id/status", requireCsrf, manage, async (req, res) =>
  ok(res, await changeStatus(req.params.id, req.body, req.user)),
);
router.put("/:id/interview", requireCsrf, manage, async (req, res) =>
  ok(res, await recordInterview(req.params.id, req.body, req.user)),
);
export default router;
