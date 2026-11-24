import { Router } from "express";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { requireCapability } from "../../middleware/authorize.js";
import {
  createInternalAccount, listInternalAccounts, getInternalAccount,
  updateInternalAccount, assignInternalRole, setInternalAccountActive,
} from "./accounts.js";

const router = Router();
const manageAccounts = requireCapability("manage-internal-accounts");
const assignRoles = requireCapability("assign-internal-roles");

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function handleError(error, res) {
  return res.status(error.status || 500).json({
    success: false, code: error.code || "INTERNAL_SERVER_ERROR", data: null,
  });
}
router.use(requireAuthentication);

router.get("/", requireCsrf, manageAccounts, async (_req, res) => {
  try { return success(res, await listInternalAccounts()); }
  catch (error) { return handleError(error, res); }
});
router.post("/", requireCsrf, manageAccounts, async (req, res) => {
  try {
    const account = await createInternalAccount({
      email: req.body?.email, password: req.body?.password,
      actorId: req.user.id, actorEmail: req.user.email,
    });
    return success(res, account, 201);
  } catch (error) { return handleError(error, res); }
});
router.get("/:id", requireCsrf, manageAccounts, async (req, res) => {
  try { return success(res, await getInternalAccount(req.params.id)); }
  catch (error) { return handleError(error, res); }
});
router.put("/:id", requireCsrf, manageAccounts, async (req, res) => {
  try {
    const account = await updateInternalAccount({
      id: req.params.id, email: req.body?.email,
      actorId: req.user.id, actorEmail: req.user.email,
    });
    return success(res, account);
  } catch (error) { return handleError(error, res); }
});
router.put("/:id/role", requireCsrf, assignRoles, async (req, res) => {
  try {
    const account = await assignInternalRole({
      id: req.params.id, roleKey: req.body?.role,
      actorId: req.user.id, actorEmail: req.user.email,
    });
    return success(res, account);
  } catch (error) { return handleError(error, res); }
});
router.patch("/:id/status", requireCsrf, manageAccounts, async (req, res) => {
  try {
    const account = await setInternalAccountActive({
      id: req.params.id, isActive: req.body?.isActive,
      actorId: req.user.id, actorEmail: req.user.email,
    });
    return success(res, account);
  } catch (error) { return handleError(error, res); }
});
export default router;
