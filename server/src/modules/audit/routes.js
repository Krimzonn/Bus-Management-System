import { Router } from "express";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import { listAudit } from "./service.js";

const router = Router();
// This capability is assigned exclusively to Admin by migration 005.
router.use(requireAuthentication, requireCapability("manage-internal-accounts"));

router.get("/", async (req, res, next) => {
  try {
    const data = await listAudit(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.status === 400 && error.code) {
      return res.status(400).json({ success: false, code: error.code, data: null });
    }
    return next(error);
  }
});
export default router;
