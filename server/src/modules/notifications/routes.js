import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
} from "./service.js";

// Express 5 forwards rejected async handlers to the app error handler, which
// maps errors that carry { status, code } to the standard JSON error shape.
// The recipient is always req.user.id (from the session); no client value is used.
const router = Router();
const viewOwn = requireCapability("view-own-notifications");
const updateOwn = requireCapability("update-own-notifications");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.use(requireAuthentication);

router.get("/", viewOwn, async (req, res) =>
  success(res, await listNotifications(req.user.id, req.query)),
);
router.get("/unread-count", viewOwn, async (req, res) =>
  success(res, await countUnreadNotifications(req.user.id)),
);
router.post("/:id/read", requireCsrf, updateOwn, async (req, res) =>
  success(res, await markNotificationRead(req.user.id, req.params.id)),
);

export default router;
