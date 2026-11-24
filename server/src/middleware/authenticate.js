import { pool } from "../database/db.js";

export async function requireAuthentication(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      data: null,
    });
  }

  try {
    const userId = req.session.user.id;

    const result = await pool.query(
      `SELECT is_active
       FROM iam_users
       WHERE id = $1`,
      [userId],
    );

    // Reject accounts that no longer exist or are inactive.
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return req.session.destroy((error) => {
        if (error) {
          return next(error);
        }

        return res.status(401).json({
          success: false,
          code: "ACCOUNT_INACTIVE",
          data: null,
        });
      });
    }

    req.user = req.session.user;

    return next();
  } catch (error) {
    return next(error);
  }
}
