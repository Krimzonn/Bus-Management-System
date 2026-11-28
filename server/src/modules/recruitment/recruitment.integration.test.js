import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const email = process.env.TEST_AUTH_EMAIL,
  password = process.env.TEST_AUTH_PASSWORD;
const applicantPassword = "Integration-Applicant-123!";
// Run against a disposable migrated test DB. Applications and audit history are retained deliberately.
test(
  "Recruitment API: authorization, workflow, persistence, audit and driver integrity",
  { skip: !email || !password },
  async () => {
    const { default: app } = await import("../../app.js");
    const { pool } = await import("../../database/db.js");
    const server = app.listen(0);
    try {
      if (!server.listening)
        await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      async function session() {
        let cookie, token;
        const csrf = await fetch(`${base}/auth/csrf`);
        assert.equal(csrf.status, 200);
        cookie = csrf.headers.getSetCookie()[0].split(";")[0];
        token = (await csrf.json()).data.csrfToken;
        return async (method, path, body, sendCsrf = true) => {
          const r = await fetch(`${base}${path}`, {
            method,
            headers: {
              Cookie: cookie,
              "Content-Type": "application/json",
              ...(sendCsrf ? { "X-CSRF-Token": token } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const data = await r.json();
          if (path === "/auth/login" && r.ok) {
            cookie = r.headers.getSetCookie()[0].split(";")[0];
            token = data.data.csrfToken;
          }
          return { status: r.status, code: data.code, data: data.data };
        };
      }
      const admin = await session();
      assert.equal(
        (await admin("POST", "/auth/login", { email, password })).status,
        200,
      );
      const anon = await session();
      assert.equal((await anon("GET", "/recruitment")).status, 401);
      assert.equal(
        (
          await anon("POST", "/recruitment/own", {
            fullName: "Ali",
            experience: "10 years",
          })
        ).status,
        401,
      );
      for (const input of [
        { email: "bad", password: applicantPassword },
        { email: "x@example.com", password: "short" },
        { email: "x@example.com", password: applicantPassword, role: "admin" },
      ])
        assert.equal(
          (await anon("POST", "/auth/register-applicant", input)).status,
          400,
        );
      const stamp = randomUUID();
      async function applicant(suffix) {
        const call = await session(),
          userEmail = `slice9-${stamp}-${suffix}@example.com`;
        const input = { email: userEmail, password: applicantPassword };
        assert.equal(
          (await call("POST", "/auth/register-applicant", input, false)).status,
          403,
        );
        const created = await call("POST", "/auth/register-applicant", input);
        assert.equal(created.status, 201);
        assert.equal(created.data.user.role, "applicant");
        assert.ok(!("password_hash" in created.data.user));
        assert.equal(
          (await call("POST", "/auth/register-applicant", input)).status,
          409,
        );
        const login = await call("POST", "/auth/login", input);
        assert.equal(login.status, 200);
        return call;
      }
      const a = await applicant("a"),
        b = await applicant("b");
      assert.equal((await a("GET", "/recruitment")).status, 403);
      assert.equal(
        (await a("POST", "/recruitment/own", { fullName: "Ali" })).status,
        400,
      );
      assert.equal(
        (
          await a("POST", "/recruitment/own", {
            fullName: "Ali",
            experience: "10 years",
            applicantId: "1",
          })
        ).status,
        400,
      );
      const submitted = await a("POST", "/recruitment/own", {
        fullName: "Applicant A",
        experience: "10 years",
      });
      assert.equal(submitted.status, 201);
      const id = submitted.data.id,
        own = `/recruitment/own/${id}`,
        review = `/recruitment/${id}`;
      assert.equal(
        (
          await a("POST", "/recruitment/own", {
            fullName: "Applicant A",
            experience: "10 years",
          })
        ).status,
        409,
      );
      assert.equal((await b("GET", own)).status, 404);
      assert.deepEqual((await b("GET", "/recruitment/own")).data, []);
      assert.equal((await b("POST", `${own}/driver`, {})).status, 404);
      assert.equal(
        (await a("PATCH", `${review}/status`, { status: "under_review" }))
          .status,
        403,
      );
      assert.equal((await a("PUT", `${review}/interview`, {})).status, 403);
      assert.equal(
        (await admin("PATCH", `${review}/status`, { status: "selected" }))
          .status,
        409,
      );
      assert.equal((await a("POST", `${own}/driver`, {})).status, 409);
      assert.equal(
        (await admin("GET", `/recruitment?q=${id}`)).data.items.some(
          (x) => x.id === id,
        ),
        true,
      );
      assert.equal(
        (
          await admin(
            "PATCH",
            `${review}/status`,
            { status: "under_review" },
            false,
          )
        ).status,
        403,
      );
      for (const status of ["under_review", "test_interview"])
        assert.equal(
          (await admin("PATCH", `${review}/status`, { status })).status,
          200,
        );
      assert.equal(
        (await admin("PATCH", `${review}/status`, { status: "selected" }))
          .status,
        409,
      );
      assert.equal(
        (
          await admin("PUT", `${review}/interview`, {
            date: "2026-02-30",
            notes: "bad",
            outcome: "passed",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await admin("PUT", `${review}/interview`, {
            date: "2025-01-01",
            notes: "ok",
            outcome: "invalid",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await admin("PUT", `${review}/interview`, {
            date: "2030-01-01",
            notes: "Scheduled",
            outcome: null,
          })
        ).status,
        200,
      );
      assert.equal(
        (await admin("PATCH", `${review}/status`, { status: "selected" }))
          .status,
        409,
      );
      assert.equal(
        (
          await admin("PUT", `${review}/interview`, {
            date: "2025-01-01",
            notes: "Interview passed",
            outcome: "passed",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await admin("PATCH", `${review}/status`, {
            status: "selected",
            reason: "Qualified",
          })
        ).status,
        200,
      );
      assert.equal(
        (await admin("PATCH", `${review}/status`, { status: "rejected" }))
          .status,
        409,
      );
      assert.equal(
        (
          await admin("PUT", `${review}/interview`, {
            date: "2025-01-01",
            notes: "Change",
            outcome: "failed",
          })
        ).status,
        409,
      );
      const driverInput = {
        licenseNumber: `S9-${stamp.slice(0, 18)}`,
        licenseCategory: "HTV",
        licenseExpiryDate: "2099-12-31",
      };
      assert.equal(
        (
          await a("POST", `${own}/driver`, {
            ...driverInput,
            licenseNumber: "",
          })
        ).status,
        400,
      );
      const results = await Promise.all([
        a("POST", `${own}/driver`, driverInput),
        a("POST", `${own}/driver`, driverInput),
      ]);
      assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
      const final = await a("GET", own);
      assert.equal(final.data.status, "selected");
      assert.ok(final.data.driver_id);
      const driver = await admin("GET", `/drivers/${final.data.driver_id}`);
      assert.equal(driver.status, 200);
      assert.equal(driver.data.fullName, "Applicant A");
      assert.deepEqual(
        final.data.history.map((x) => x.event),
        [
          "submitted",
          "status_changed",
          "status_changed",
          "interview_recorded",
          "interview_recorded",
          "status_changed",
          "driver_registered",
        ],
      );
      const audit = await pool.query(
        `SELECT action,actor_id,before_data,after_data FROM audit_logs WHERE entity_type='application' AND entity_id=$1 ORDER BY id`,
        [id],
      );
      assert.deepEqual(
        audit.rows.map((x) => x.action),
        final.data.history.map((x) => `recruitment.${x.event}`),
      );
      assert.equal(audit.rows.at(-1).after_data.driverId, final.data.driver_id);
      assert.equal(audit.rows[5].before_data.status, "test_interview");
      assert.equal(audit.rows[5].after_data.status, "selected");
      const second = await b("POST", "/recruitment/own", {
        fullName: "Applicant B",
        experience: "Two years",
      });
      assert.equal(second.status, 201);
      const reject = `/recruitment/${second.data.id}`;
      for (const status of ["under_review", "test_interview"])
        assert.equal(
          (await admin("PATCH", `${reject}/status`, { status })).status,
          200,
        );
      assert.equal(
        (
          await admin("PUT", `${reject}/interview`, {
            date: "2025-01-01",
            notes: "Interview failed",
            outcome: "failed",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await admin("PATCH", `${reject}/status`, {
            status: "rejected",
            reason: "Not qualified",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await b(
            "POST",
            `/recruitment/own/${second.data.id}/driver`,
            driverInput,
          )
        ).status,
        409,
      );
      assert.equal(
        (await b("GET", `/recruitment/own/${second.data.id}`)).data.status,
        "rejected",
      );
      // A second selected account cannot reuse an already registered license.
      const c = await applicant("c");
      const third = await c("POST", "/recruitment/own", {
        fullName: "Applicant C",
        experience: "Five years",
      });
      assert.equal(third.status, 201);
      const thirdReview = `/recruitment/${third.data.id}`,
        thirdOwn = `/recruitment/own/${third.data.id}`;
      for (const status of ["under_review", "test_interview"])
        assert.equal(
          (await admin("PATCH", `${thirdReview}/status`, { status })).status,
          200,
        );
      assert.equal(
        (
          await admin("PUT", `${thirdReview}/interview`, {
            date: "2025-01-01",
            notes: "Qualified",
            outcome: "passed",
          })
        ).status,
        200,
      );
      assert.equal(
        (await admin("PATCH", `${thirdReview}/status`, { status: "selected" }))
          .status,
        200,
      );
      const duplicate = await c("POST", `${thirdOwn}/driver`, driverInput);
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.code, "DRIVER_LICENSE_ALREADY_EXISTS");
      const unchanged = await c("GET", thirdOwn);
      assert.equal(unchanged.data.driver_id, null);
      assert.equal(
        unchanged.data.history.some((h) => h.event === "driver_registered"),
        false,
      );
      const driverAudit = await pool.query(
        `SELECT action,actor_id FROM audit_logs WHERE entity_type='driver' AND entity_id=$1 AND action='driver.created'`,
        [final.data.driver_id],
      );
      assert.equal(driverAudit.rows.length, 1);
      assert.equal(
        String(driverAudit.rows[0].actor_id),
        final.data.applicant_id,
      );
      // Managers have read-only recruitment access, as in the permission baseline.
      const managerEmail = `slice9-${stamp}-manager@example.com`;
      const managerAccount = await admin("POST", "/accounts", {
        email: managerEmail,
        password: applicantPassword,
      });
      assert.equal(managerAccount.status, 201);
      assert.equal(
        (
          await admin("PUT", `/accounts/${managerAccount.data.id}/role`, {
            role: "transportation_manager",
          })
        ).status,
        200,
      );
      const manager = await session();
      assert.equal(
        (
          await manager("POST", "/auth/login", {
            email: managerEmail,
            password: applicantPassword,
          })
        ).status,
        200,
      );
      assert.equal((await manager("GET", review)).status, 200);
      assert.equal(
        (await manager("PATCH", `${review}/status`, { status: "rejected" }))
          .status,
        403,
      );
      assert.equal((await manager("GET", "/recruitment/own")).status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  },
);
