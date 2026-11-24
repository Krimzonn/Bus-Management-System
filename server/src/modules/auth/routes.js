import express from "express";
import { authenticateUser } from "./service.js";
import { generateCsrfToken, requireCsrf } from "../../middleware/csrf.js";
import { requireAuthentication } from "../../middleware/authenticate.js";

const router = express.Router();

// Obtain a CSRF token before login.
router.get("/csrf", (req, res) => {
  const token = generateCsrfToken(req);

  req.session.save((error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        code: "SESSION_SAVE_FAILED",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: { csrfToken: token },
    });
  });
});

// Login.
router.post("/login", requireCsrf, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_INPUT",
        data: null,
      });
    }

    const user = await authenticateUser(email, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        data: null,
      });
    }

    // Prevent session fixation.
    req.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      req.session.user = user;
      const csrfToken = generateCsrfToken(req);

      req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }

        return res.status(200).json({
          success: true,
          data: {
            user,
            csrfToken,
          },
        });
      });
    });
  } catch (error) {
    return next(error);
  }
});

// Current authenticated user.
router.get("/me", requireAuthentication, (req, res) => {
  res.status(200).json({
    success: true,
    data: { user: req.user },
  });
});

// Logout.
router.post("/logout", requireAuthentication, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie("bus_management.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.status(200).json({
      success: true,
      data: null,
    });
  });
});

export default router;
