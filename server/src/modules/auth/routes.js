import express from "express";
import { registerApplicant } from "./accounts.js";
import { authenticateUser } from "./service.js";
import { generateCsrfToken, requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";
import { recordBestEffort } from "../audit/writer.js";

const router = express.Router();

router.get("/csrf", (req, res) => {
  const token =
    typeof req.session.csrfToken === "string"
      ? req.session.csrfToken
      : generateCsrfToken(req);

  req.session.save((error) => {
    if (error)
      return res
        .status(500)
        .json({ success: false, code: "SESSION_SAVE_FAILED", data: null });
    return res.status(200).json({ success: true, data: { csrfToken: token } });
  });
});

router.post("/register-applicant", requireCsrf, async (req, res) => {
  const user = await registerApplicant(req.body);
  return res.status(201).json({ success: true, data: { user } });
});

router.post("/login", requireCsrf, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res
        .status(400)
        .json({ success: false, code: "INVALID_INPUT", data: null });
    }
    const user = await authenticateUser(email, password);
    if (!user)
      return res
        .status(401)
        .json({ success: false, code: "INVALID_CREDENTIALS", data: null });

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = user;
      const csrfToken = generateCsrfToken(req);
      void recordBestEffort({
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login_succeeded",
        entityType: "auth",
        entityId: user.id,
        before: null,
        after: { email: user.email },
      });
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res
          .status(200)
          .json({ success: true, data: { user, csrfToken } });
      });
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuthentication, (req, res) => {
  return res.status(200).json({ success: true, data: { user: req.user } });
});

router.post("/logout", requireAuthentication, requireCsrf, (req, res, next) => {
  void recordBestEffort({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "auth.logout",
    entityType: "auth",
    entityId: req.user.id,
    before: null,
    after: { email: req.user.email },
  });
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("bus_management.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res.status(200).json({ success: true, data: null });
  });
});

export default router;
