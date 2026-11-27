import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import { getDriverAssignmentEligibility } from "./index.js";
import { createDriver } from "./service.js";

// Needs a migrated database and an Admin account (same variables as auth.integration.test.js).
const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;
const TEMP_PASSWORD = "Integration-Pass-123!";

async function openSession(base, userEmail, userPassword) {
  const csrfRes = await fetch(`${base}/auth/csrf`);
  const csrf = (await csrfRes.json()).data.csrfToken;
  let cookie = csrfRes.headers.getSetCookie()[0].split(";")[0];
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(loginRes.status, 200, `login failed for ${userEmail}`);
  cookie = loginRes.headers.getSetCookie()[0].split(";")[0];
  const token = (await loginRes.json()).data.csrfToken;
  const call = async (method, path, body, { csrf: sendCsrf = true } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json", Cookie: cookie,
        ...(sendCsrf ? { "X-CSRF-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return call;
}

test("driver records, expiry monitoring, eligibility, audit and permissions", { skip: !email || !password }, async (t) => {
  const server = app.listen(0);
  const createdAccountIds = [];
  const createdDriverIds = [];
  let admin;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    admin = await openSession(base, email, password);

    const stamp = Date.now();
    const today = businessToday();
    const payload = (suffix, overrides = {}) => ({
      fullName: `Integration Driver ${stamp} ${suffix}`, licenseNumber: `IT-${stamp}-${suffix}`,
      licenseCategory: "HTV", licenseExpiryDate: addDays(today, 365), ...overrides,
    });
    async function sessionWithRole(role) {
      const userEmail = `it-drivers-${role ?? "none"}-${stamp}@example.com`;
      const created = await admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD });
      assert.equal(created.status, 201);
      createdAccountIds.push(created.body.data.id);
      if (role) {
        assert.equal((await admin("PUT", `/accounts/${created.body.data.id}/role`, { role })).status, 200);
      }
      return openSession(base, userEmail, TEMP_PASSWORD);
    }
    const manager = await sessionWithRole("transportation_manager");
    async function create(suffix, overrides) {
      const res = await manager("POST", "/drivers", payload(suffix, overrides));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      createdDriverIds.push(res.body.data.id);
      return res.body.data;
    }

    let main;
    await t.test("create, view, search, filter and edit", async () => {
      main = await create("MAIN");
      assert.equal(main.status, "available");
      assert.equal(main.licenseExpiryDate, addDays(today, 365));
      assert.deepEqual((await manager("GET", `/drivers/${main.id}`)).body.data, main);

      const found = async (query) => (await manager("GET", `/drivers?${query}`)).body.data.items.map((d) => d.id);
      assert.deepEqual(await found(`q=${stamp}%20main`), [main.id]);
      assert.deepEqual(await found(`q=it${stamp}main`), [main.id]);
      assert.deepEqual(await found(`q=it-${stamp}-main&status=available&licenseCategory=htv&licenseStatus=valid`), [main.id]);
      assert.deepEqual(await found(`q=it-${stamp}-main&status=absent`), []);
      assert.deepEqual(await found(`q=it-${stamp}-main&licenseStatus=expired`), []);

      const edited = await manager("PUT", `/drivers/${main.id}`, { fullName: `Edited ${stamp}`, licenseCategory: "ltv" });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.licenseCategory, "LTV");
      assert.equal((await manager("PUT", `/drivers/${main.id}`, { licenseCategory: "HTV" })).status, 200);
    });

    await t.test("invalid requests", async () => {
      const code = async (method, path, body) => (await manager(method, path, body)).body.code;
      assert.equal(await code("POST", "/drivers", payload("BAD", { licenseNumber: undefined })), "INVALID_LICENSE_NUMBER");
      assert.equal(await code("POST", "/drivers", payload("BAD", { licenseExpiryDate: "2027-02-30" })), "INVALID_LICENSE_EXPIRY_DATE");
      assert.equal(await code("POST", "/drivers", payload("BAD", { licenseCategory: "H_TV" })), "INVALID_LICENSE_CATEGORY");
      assert.equal(await code("PATCH", `/drivers/${main.id}/status`, { status: "On Leave" }), "INVALID_DRIVER_STATUS");
      assert.equal(await code("PUT", `/drivers/${main.id}`, { status: "absent" }), "INVALID_INPUT");
      assert.equal(await code("GET", "/drivers/abc"), "INVALID_DRIVER_ID");
      assert.equal((await manager("GET", "/drivers/999999999")).status, 404);
      assert.equal((await manager("DELETE", `/drivers/${main.id}`)).status, 404);
    });

    await t.test("license uniqueness through the API and in the database", async () => {
      for (const licenseNumber of [
        `IT-${stamp}-MAIN`, ` it-${stamp}-main `, `IT${stamp}MAIN`, `IT ${stamp}/MAIN`,
      ]) {
        const res = await manager("POST", "/drivers", payload("DUP", { licenseNumber }));
        assert.equal(res.status, 409, licenseNumber);
        assert.equal(res.body.code, "DRIVER_LICENSE_ALREADY_EXISTS");
      }
      const other = await create("OTHER");
      const res = await manager("PUT", `/drivers/${other.id}`, { licenseNumber: main.licenseNumber });
      assert.equal(res.body.code, "DRIVER_LICENSE_ALREADY_EXISTS");
      // Bypassing the application still fails.
      await assert.rejects(
        pool.query(
          `INSERT INTO drivers_drivers (full_name, license_number, license_category, license_expiry_date)
           VALUES ('X', $1, 'HTV', '2030-01-01')`,
          [`IT${stamp}MAIN`],
        ),
        { code: "23505", constraint: "drivers_drivers_license_key" },
      );
      await assert.rejects(
        pool.query("UPDATE drivers_drivers SET status = 'busy' WHERE id = $1", [main.id]),
        { code: "23514" },
      );
    });

    await t.test("simultaneous duplicate creation yields exactly one driver", async () => {
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => manager("POST", "/drivers", payload("RACE"))),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
      createdDriverIds.push(results.find((r) => r.status === 201).body.data.id);
    });

    await t.test("expiry boundaries", async () => {
      const ids = {};
      for (const days of [-1, 0, 30, 31]) {
        ids[days] = (await create(`EXP${days}`, { licenseExpiryDate: addDays(today, days) })).id;
      }
      const idsIn = async (state) => {
        const all = [];
        for (let page = 1; ; page += 1) {
          const { data } = (await manager("GET", `/drivers/license-expiry?state=${state}&limit=100&page=${page}`)).body;
          all.push(...data.items.map((d) => d.id));
          if (all.length >= data.total) return all;
        }
      };
      const members = async (state) => {
        const list = await idsIn(state);
        return [-1, 0, 30, 31].filter((days) => list.includes(ids[days]));
      };
      assert.deepEqual(await members("expired"), [-1]);
      assert.deepEqual(await members("expiring_soon"), [0, 30]);
      assert.deepEqual(await members("valid"), [0, 30, 31]);
      const defaulted = (await manager("GET", "/drivers/license-expiry")).body.data;
      assert.equal(defaulted.state, "expiring_soon");
      assert.equal(defaulted.asOf, today);
      const dates = defaulted.items.map((d) => d.licenseExpiryDate);
      assert.deepEqual(dates, [...dates].sort());

      assert.equal((await manager("POST", `/drivers/${ids[0]}/archive`)).status, 200);
      assert.deepEqual(await members("expiring_soon"), [30]);
    });

    await t.test("status, eligibility and archival", async () => {
      const trip = { tripDate: main.licenseExpiryDate, requiredLicenseCategory: "HTV" };
      const check = (overrides) => getDriverAssignmentEligibility(main.id, { ...trip, ...overrides });
      assert.deepEqual(await check(), { eligible: true, reason: null });
      assert.equal((await check({ tripDate: addDays(trip.tripDate, 1) })).reason, "LICENSE_EXPIRED");
      assert.equal((await check({ requiredLicenseCategory: "LTV" })).reason, "LICENSE_CATEGORY_MISMATCH");
      // The caller's transaction client works as the executor.
      assert.equal((await withTransaction((tx) => getDriverAssignmentEligibility(main.id, trip, tx))).eligible, true);

      for (const [status, reason] of [["on_leave", "DRIVER_ON_LEAVE"], ["absent", "DRIVER_ABSENT"], ["available", null]]) {
        const res = await manager("PATCH", `/drivers/${main.id}/status`, { status });
        assert.equal(res.body.data.status, status);
        assert.equal((await check()).reason, reason);
      }

      assert.equal((await manager("POST", `/drivers/${main.id}/archive`)).status, 200);
      assert.equal((await check()).reason, "DRIVER_ARCHIVED");
      assert.equal((await manager("GET", `/drivers/${main.id}`)).body.data.isArchived, true);
      assert.equal((await manager("GET", `/drivers?q=it-${stamp}-main`)).body.data.total, 0);
      assert.equal((await manager("GET", `/drivers?q=it-${stamp}-main&archived=all`)).body.data.total, 1);
      assert.equal((await manager("PUT", `/drivers/${main.id}`, { fullName: "No" })).body.code, "DRIVER_ARCHIVED");
      assert.equal((await manager("PATCH", `/drivers/${main.id}/status`, { status: "absent" })).body.code, "DRIVER_ARCHIVED");
      assert.equal((await manager("POST", `/drivers/${main.id}/archive`)).body.code, "DRIVER_ALREADY_ARCHIVED");
      assert.equal((await manager("POST", "/drivers", payload("MAIN"))).body.code, "DRIVER_LICENSE_ALREADY_EXISTS");
    });

    await t.test("audit trail", async () => {
      const audit = await admin("GET", `/audit?entityType=driver&entityId=${main.id}&limit=100`);
      assert.equal(audit.status, 200);
      const count = (action) => audit.body.data.items.filter((e) => e.action === action).length;
      assert.equal(count("driver.created"), 1);
      assert.equal(count("driver.updated"), 1);
      assert.equal(count("driver.license_updated"), 2);
      assert.equal(count("driver.status_changed"), 3);
      assert.equal(count("driver.archived"), 1);
    });

    await t.test("a failed audit write leaves no driver behind", async () => {
      await assert.rejects(
        createDriver({ input: payload("ATOMIC"), actorId: "1", actorEmail: "not-an-email" }),
        /INVALID_AUDIT_ACTOR/,
      );
      const rows = await pool.query("SELECT 1 FROM drivers_drivers WHERE license_number = $1", [`IT-${stamp}-ATOMIC`]);
      assert.equal(rows.rowCount, 0);
    });

    await t.test("role permissions", async () => {
      const target = await create("PERM");
      const reads = ["/drivers", "/drivers/license-expiry", `/drivers/${target.id}`];
      const writes = [
        ["POST", "/drivers", payload("DENIED")],
        ["PUT", `/drivers/${target.id}`, { fullName: "Nope" }],
        ["PATCH", `/drivers/${target.id}/status`, { status: "absent" }],
        ["POST", `/drivers/${target.id}/archive`, undefined],
      ];
      const denied = async (session, method, path, body) => {
        const res = await session(method, path, body);
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal(res.body.code, "INSUFFICIENT_PERMISSION");
        assert.equal(res.body.data, null);
      };

      // Unauthenticated.
      for (const path of reads) assert.equal((await fetch(`${base}${path}`)).status, 401);
      for (const [method, path] of writes) {
        assert.equal((await fetch(`${base}${path}`, { method })).status, 401);
      }

      // Admin has full access (project permission baseline).
      for (const path of reads) assert.equal((await admin("GET", path)).status, 200);
      assert.equal((await admin("PUT", `/drivers/${target.id}`, { fullName: target.fullName })).status, 200);

      const staff = await sessionWithRole("administrative_staff");
      for (const path of reads) assert.equal((await staff("GET", path)).status, 200);
      for (const write of writes) await denied(staff, ...write);

      for (const role of ["driver", "applicant", "passenger", null]) {
        const session = await sessionWithRole(role);
        for (const path of reads) await denied(session, "GET", path);
        for (const write of writes) await denied(session, ...write);
      }

      // CSRF is required even for a permitted role.
      for (const [method, path, body] of writes) {
        const res = await manager(method, path, body, { csrf: false });
        assert.equal(res.body.code, "CSRF_VALIDATION_FAILED");
      }
      assert.deepEqual((await manager("GET", `/drivers/${target.id}`)).body.data, target);
    });

    const { rows } = await pool.query("SELECT current_user AS role");
    await t.test("runtime role cannot delete drivers or alter audit history",
      { skip: rows[0].role !== "bus_app" && "DATABASE_URL does not use the bus_app role" }, async () => {
        for (const sql of [
          "DELETE FROM drivers_drivers WHERE FALSE", "TRUNCATE drivers_drivers",
          "UPDATE audit_logs SET action = action WHERE FALSE", "DELETE FROM audit_logs WHERE FALSE",
          "TRUNCATE audit_logs",
        ]) {
          await assert.rejects(pool.query(sql), { code: "42501" }, sql);
        }
      });
  } finally {
    // Drivers are never deleted, so test records are archived out of active lists.
    if (admin) {
      for (const driverId of createdDriverIds) await admin("POST", `/drivers/${driverId}/archive`);
      for (const accountId of createdAccountIds) {
        await admin("PATCH", `/accounts/${accountId}/status`, { isActive: false });
      }
    }
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
