import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateCsrfToken(req) {
  const token = randomBytes(32).toString("hex");
  req.session.csrfToken = token;
  return token;
}

export function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const received = req.get("X-CSRF-Token");

  if (typeof expected !== "string" || typeof received !== "string") {
    return res.status(403).json({
      success: false,
      code: "CSRF_VALIDATION_FAILED",
      data: null,
    });
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return res.status(403).json({
      success: false,
      code: "CSRF_VALIDATION_FAILED",
      data: null,
    });
  }

  return next();
}
