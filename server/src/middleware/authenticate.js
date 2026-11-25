import { pool } from "../database/db.js";

export async function requireAuthentication(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, code: "AUTHENTICATION_REQUIRED", data: null });
  }

  try {
    // Session ID is only a locator; current identity and permissions come from DB.
    const result = await pool.query(
      `SELECT u.id, u.email, u.is_active, r.role_key
       FROM iam_users AS u
       LEFT JOIN iam_roles AS r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.session.user.id],
    );
    const user = result.rows[0];

    if (!user || !user.is_active) {
      return req.session.destroy((error) => {
        if (error) return next(error);
        return res.status(401).json({ success: false, code: "ACCOUNT_INACTIVE", data: null });
      });
    }

    req.user = { id: String(user.id), email: user.email, role: user.role_key ?? null };
    return next();
  } catch (error) {
    return next(error);
  }
}
