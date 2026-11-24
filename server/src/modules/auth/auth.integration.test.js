import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";

const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;

test(
  "complete login, session, and logout lifecycle",
  { skip: !email || !password },
  async () => {
    const server = app.listen(0);

    try {
      await new Promise((resolve) => server.once("listening", resolve));

      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // 1. Obtain CSRF token and initial session cookie.
      const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`);

      assert.equal(csrfResponse.status, 200);

      const csrfData = await csrfResponse.json();
      let cookie = csrfResponse.headers.getSetCookie()[0]?.split(";")[0];

      assert.ok(cookie);
      assert.ok(csrfData.data.csrfToken);

      // 2. Login.
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-CSRF-Token": csrfData.data.csrfToken,
        },
        body: JSON.stringify({ email, password }),
      });

      assert.equal(loginResponse.status, 200);

      const loginData = await loginResponse.json();
      cookie = loginResponse.headers.getSetCookie()[0]?.split(";")[0];

      assert.ok(cookie);
      assert.equal(loginData.data.user.email, email.toLowerCase());

      // 3. Verify authenticated session.
      const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: cookie },
      });

      assert.equal(meResponse.status, 200);

      // 4. Logout using the rotated CSRF token.
      const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": loginData.data.csrfToken,
        },
      });

      assert.equal(logoutResponse.status, 200);

      // 5. Confirm the old session no longer works.
      const afterLogoutResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: cookie },
      });

      assert.equal(afterLogoutResponse.status, 401);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  },
);
