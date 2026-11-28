import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { addDays, businessToday } from "../../utils/business-date.js";

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
  return async (method, path, body, { csrf: sendCsrf = true } = {}) => {
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
}

test("replacement drivers against PostgreSQL", { skip: !email || !password }, async (t) => {
  const server = app.listen(0);
  const created = { accounts: [], buses: [], drivers: [], routes: [] };
  let admin;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    admin = await openSession(base, email, password);
    const stamp = Date.now();
    let sequence = 0;
    const day = addDays(businessToday(), 400);

    const ok = async (promise, status = 200) => {
      const res = await promise;
      assert.equal(res.status, status, JSON.stringify(res.body));
      return res.body.data;
    };
    const failsWith = async (promise, status, code) => {
      const res = await promise;
      assert.deepEqual([res.status, res.body.code], [status, code], JSON.stringify(res.body));
      assert.equal(res.body.data, null);
    };

    async function account(role) {
      const userEmail = `it-repl-${role ?? "none"}-${stamp}-${sequence += 1}@example.com`;
      const { id } = await ok(admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD }), 201);
      created.accounts.push(id);
      if (role) await ok(admin("PUT", `/accounts/${id}/role`, { role }));
      return { id, call: await openSession(base, userEmail, TEMP_PASSWORD) };
    }
    const managerAccount = await account("transportation_manager");
    const manager = managerAccount.call;

    async function newBus(overrides = {}) {
      const bus = await ok(manager("POST", "/buses", {
        busNumber: `RP${stamp}-${sequence += 1}`, seatingCapacity: 40, requiredLicenseCategory: "HTV",
        ...overrides,
      }), 201);
      created.buses.push(bus.id);
      return bus;
    }
    async function newDriver(overrides = {}) {
      const n = sequence += 1;
      const driver = await ok(manager("POST", "/drivers", {
        fullName: `Replacement Driver ${stamp} ${n}`, licenseNumber: `RD-${stamp}-${n}`,
        licenseCategory: "HTV", licenseExpiryDate: addDays(day, 3000), ...overrides,
      }), 201);
      created.drivers.push(driver.id);
      return driver;
    }
    async function newRoute() {
      const route = await ok(manager("POST", "/routes", {
        routeCode: `RR${stamp}-${sequence += 1}`, name: "Test", origin: "A", destination: "B",
      }), 201);
      created.routes.push(route.id);
      return route;
    }
    async function newSet() {
      return {
        busId: (await newBus()).id,
        driverId: (await newDriver()).id,
        routeId: (await newRoute()).id,
      };
    }
    const trip = (set, overrides = {}) => ({
      travelDate: day, departureTime: "10:00", arrivalTime: "14:00", ...set, ...overrides,
    });
    const book = (body) => manager("POST", "/schedules", body);
    const booked = (body) => ok(book(body), 201);
    const act = (id, action) => manager("POST", `/schedules/${id}/${action}`);
    const candidates = (id, session = manager) => session("GET", `/schedules/${id}/replacement-candidates`);
    const replace = (id, driverId, session = manager, options) =>
      session("POST", `/schedules/${id}/replacement`, { driverId }, options);
    const candidateIds = async (id) => (await ok(candidates(id))).candidates.map((c) => c.id);
    const countFor = async (column, id) => Number((await pool.query(
      `SELECT COUNT(*) FROM scheduling_schedules WHERE ${column} = $1`, [id],
    )).rows[0].count);
    const auditFor = async (entityType, entityId) =>
      (await ok(admin("GET", `/audit?entityType=${entityType}&entityId=${entityId}&limit=100`))).items;
    const replacedEvents = async (id) => (await auditFor("schedule", id))
      .filter((e) => e.action === "schedule.driver_replaced")
      .sort((a, b) => Number(a.id) - Number(b.id));

    await t.test("only eligible drivers are suggested, and suggesting changes nothing", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const eligible = await newDriver();
      const onLeave = await newDriver({ status: "on_leave" });
      const absent = await newDriver({ status: "absent" });
      const archived = await newDriver();
      await ok(manager("POST", `/drivers/${archived.id}/archive`));
      const expired = await newDriver({ licenseExpiryDate: addDays(day, -1) });
      const wrongCategory = await newDriver({ licenseCategory: "LTV" });
      const busy = await newDriver();
      await booked(trip({ ...(await newSet()), driverId: busy.id }));
      const cancelledOnly = await newDriver();
      const cancelled = await booked(trip({ ...(await newSet()), driverId: cancelledOnly.id }));
      await ok(act(cancelled.id, "cancel"));
      const backToBack = await newDriver();
      await booked(trip({ ...(await newSet()), driverId: backToBack.id }, { departureTime: "06:00", arrivalTime: "10:00" }));

      const result = await ok(candidates(schedule.id));
      const ids = result.candidates.map((c) => c.id);
      for (const driver of [eligible, cancelledOnly, backToBack]) assert.ok(ids.includes(driver.id), driver.fullName);
      for (const driver of [onLeave, absent, archived, expired, wrongCategory, busy]) {
        assert.equal(ids.includes(driver.id), false, driver.fullName);
      }
      assert.equal(ids.includes(set.driverId), false, "the current driver is not a candidate");
      assert.equal(result.currentDriverId, set.driverId);
      assert.equal(result.emptyReason, null);
      assert.equal(result.summary.withoutConflict, ids.length);
      assert.deepEqual(Object.keys(result.candidates[0]).sort(),
        ["fullName", "id", "licenseCategory", "licenseExpiryDate"]);

      // Nothing was assigned automatically.
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);
      assert.equal((await auditFor("schedule", schedule.id)).length, 1);
    });

    await t.test("an empty result is explained", async () => {
      const category = `ZX${stamp}`;
      const bus = await newBus({ requiredLicenseCategory: category });
      const current = await newDriver({ licenseCategory: category });
      const route = await newRoute();
      const schedule = await booked(trip({ busId: bus.id, driverId: current.id, routeId: route.id }));

      let result = await ok(candidates(schedule.id));
      assert.deepEqual(result.candidates, []);
      assert.equal(result.emptyReason, "NO_CATEGORY_MATCH");

      const other = await newDriver({ licenseCategory: category });
      const otherBus = await newBus({ requiredLicenseCategory: category });
      await booked(trip({ busId: otherBus.id, driverId: other.id, routeId: route.id }));
      result = await ok(candidates(schedule.id));
      assert.deepEqual(result.candidates, []);
      assert.equal(result.emptyReason, "ALL_HAVE_CONFLICTS");
      assert.equal(result.summary.categoryQualified, 1);
      assert.equal(result.summary.withoutConflict, 0);
      await failsWith(replace(schedule.id, other.id), 409, "SCHEDULE_DRIVER_CONFLICT");
      const wrong = await newDriver({ licenseCategory: "LTV" });
      await failsWith(replace(schedule.id, wrong.id), 409, "LICENSE_CATEGORY_MISMATCH");

      await ok(manager("PATCH", `/buses/${bus.id}/status`, { status: "inactive" }));
      result = await ok(candidates(schedule.id));
      assert.deepEqual([result.candidates, result.emptyReason], [[], "BUS_INACTIVE"]);
    });

    await t.test("the manager's choice is saved, audited, and access moves with the trip", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const replacement = await newDriver();
      const oldLogin = await account("driver");
      const newLogin = await account("driver");
      await ok(admin("PUT", `/drivers/${set.driverId}/account`, { userId: oldLogin.id }));
      await ok(admin("PUT", `/drivers/${replacement.id}/account`, { userId: newLogin.id }));
      assert.ok((await candidateIds(schedule.id)).includes(replacement.id));

      const replaced = await ok(replace(schedule.id, replacement.id));
      assert.equal(replaced.driverId, replacement.id);
      assert.equal(replaced.driver.id, replacement.id);
      for (const key of ["busId", "routeId", "travelDate", "departureTime", "arrivalTime", "status"]) {
        assert.equal(replaced[key], schedule[key], key);
      }
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), replaced);

      const events = await replacedEvents(schedule.id);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].before_data, { driverId: set.driverId });
      assert.deepEqual(events[0].after_data, { driverId: replacement.id });
      assert.equal(String(events[0].actor_id), managerAccount.id);
      assert.ok(events[0].created_at);
      assert.deepEqual((await auditFor("schedule", schedule.id)).map((e) => e.action).sort(),
        ["schedule.created", "schedule.driver_replaced"]);

      await ok(newLogin.call("GET", `/schedules/mine/${schedule.id}`));
      await failsWith(oldLogin.call("GET", `/schedules/mine/${schedule.id}`), 404, "SCHEDULE_NOT_FOUND");

      // The old driver can be chosen again; history keeps both steps. No row is lost.
      await ok(replace(schedule.id, set.driverId));
      assert.equal((await replacedEvents(schedule.id)).length, 2);
      assert.equal(await countFor("bus_id", set.busId), 1);
    });

    await t.test("invalid requests", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const other = await newDriver();
      await failsWith(replace(schedule.id, set.driverId), 409, "REPLACEMENT_SAME_DRIVER");
      await failsWith(replace(schedule.id, "999999999"), 404, "DRIVER_NOT_FOUND");
      for (const driverId of ["abc", "0", null]) {
        await failsWith(replace(schedule.id, driverId), 400, "INVALID_DRIVER_ID");
      }
      await failsWith(manager("POST", `/schedules/${schedule.id}/replacement`, { driverId: other.id, status: "x" }),
        400, "INVALID_INPUT");
      await failsWith(replace("999999999", other.id), 404, "SCHEDULE_NOT_FOUND");
      await failsWith(candidates("999999999"), 404, "SCHEDULE_NOT_FOUND");
      await failsWith(candidates("abc"), 400, "INVALID_SCHEDULE_ID");

      // Only a trip that has not started can be given a replacement.
      await ok(act(schedule.id, "start"));
      await failsWith(replace(schedule.id, other.id), 409, "SCHEDULE_NOT_EDITABLE");
      await failsWith(candidates(schedule.id), 409, "SCHEDULE_NOT_EDITABLE");
      await ok(act(schedule.id, "complete"));
      await failsWith(replace(schedule.id, other.id), 409, "SCHEDULE_NOT_EDITABLE");
      const cancelled = await booked(trip(await newSet(), { travelDate: addDays(day, 1) }));
      await ok(act(cancelled.id, "cancel"));
      await failsWith(replace(cancelled.id, other.id), 409, "SCHEDULE_NOT_EDITABLE");
      assert.equal((await replacedEvents(schedule.id)).length, 0);
    });

    await t.test("a candidate that became ineligible after the suggestion is refused", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const [a, b, c, d] = [await newDriver(), await newDriver(), await newDriver(), await newDriver()];
      const suggested = await candidateIds(schedule.id);
      for (const driver of [a, b, c, d]) assert.ok(suggested.includes(driver.id));

      await ok(manager("PATCH", `/drivers/${a.id}/status`, { status: "absent" }));
      await failsWith(replace(schedule.id, a.id), 409, "DRIVER_ABSENT");
      await ok(manager("POST", `/drivers/${b.id}/archive`));
      await failsWith(replace(schedule.id, b.id), 409, "DRIVER_ARCHIVED");
      await booked(trip({ ...(await newSet()), driverId: c.id }));
      await failsWith(replace(schedule.id, c.id), 409, "SCHEDULE_DRIVER_CONFLICT");
      await ok(manager("PUT", `/drivers/${d.id}`, { licenseExpiryDate: addDays(day, -1) }));
      await failsWith(replace(schedule.id, d.id), 409, "LICENSE_EXPIRED");

      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);
      assert.equal((await auditFor("schedule", schedule.id)).length, 1);
    });

    await t.test("concurrent replacements into the same slot: only one succeeds", async () => {
      for (let round = 0; round < 5; round += 1) {
        const driver = await newDriver();
        const schedules = [];
        for (let i = 0; i < 5; i += 1) schedules.push(await booked(trip(await newSet())));
        const results = await Promise.all(schedules.map((s) => replace(s.id, driver.id)));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409, 409],
          JSON.stringify(results.map((r) => r.body)));
        for (const res of results.filter((r) => r.status === 409)) {
          assert.equal(res.body.code, "SCHEDULE_DRIVER_CONFLICT");
        }
        assert.equal(await countFor("driver_id", driver.id), 1);
      }
    });

    await t.test("a replacement racing a new booking for the same driver: only one wins", async () => {
      for (let round = 0; round < 5; round += 1) {
        const driver = await newDriver();
        const schedule = await booked(trip(await newSet()));
        const [replaced, bookedRes] = await Promise.all([
          replace(schedule.id, driver.id),
          book(trip({ ...(await newSet()), driverId: driver.id })),
        ]);
        const statuses = [replaced.status, bookedRes.status].sort();
        assert.ok(
          (statuses[0] === 200 && statuses[1] === 409) || (statuses[0] === 201 && statuses[1] === 409),
          JSON.stringify([replaced.body, bookedRes.body]),
        );
        assert.equal(await countFor("driver_id", driver.id), 1);
      }
    });

    await t.test("two different replacements of one trip are serialized with an unbroken history", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const [a, b] = [await newDriver(), await newDriver()];
      const results = await Promise.all([replace(schedule.id, a.id), replace(schedule.id, b.id)]);
      assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results.map((r) => r.body)));
      const events = await replacedEvents(schedule.id);
      assert.equal(events.length, 2);
      assert.equal(events[0].before_data.driverId, set.driverId);
      assert.equal(events[1].before_data.driverId, events[0].after_data.driverId);
      assert.equal((await ok(manager("GET", `/schedules/${schedule.id}`))).driverId, events[1].after_data.driverId);
      assert.equal(await countFor("bus_id", set.busId), 1);
    });

    await t.test("an uncommitted status change blocks the reassignment until it is decided", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const candidate = await newDriver();
      const other = await pool.connect();
      let pending;
      try {
        await other.query("BEGIN");
        await other.query("UPDATE drivers_drivers SET status = 'absent' WHERE id = $1", [candidate.id]);
        let settled = false;
        pending = replace(schedule.id, candidate.id).finally(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.equal(settled, false, "reassignment did not wait");
        await other.query("COMMIT");
      } finally {
        other.release();
      }
      await failsWith(pending, 409, "DRIVER_ABSENT");
      assert.equal((await ok(manager("GET", `/schedules/${schedule.id}`))).driverId, set.driverId);
    });

    await t.test("permissions", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      const replacement = await newDriver();
      const denied = (session, method, path, body) =>
        failsWith(session(method, path, body), 403, "INSUFFICIENT_PERMISSION");
      const read = `/schedules/${schedule.id}/replacement-candidates`;
      const write = `/schedules/${schedule.id}/replacement`;

      assert.equal((await fetch(`${base}${read}`)).status, 401);
      assert.equal((await fetch(`${base}${write}`, { method: "POST" })).status, 401);

      const staff = (await account("administrative_staff")).call;
      await denied(staff, "GET", read);
      await denied(staff, "POST", write, { driverId: replacement.id });
      for (const role of ["driver", "applicant", "passenger", null]) {
        const session = (await account(role)).call;
        await denied(session, "GET", read);
        await denied(session, "POST", write, { driverId: replacement.id });
      }
      // Even the driver who owns the trip cannot reassign it.
      const owner = await account("driver");
      await ok(admin("PUT", `/drivers/${set.driverId}/account`, { userId: owner.id }));
      await denied(owner.call, "GET", read);
      await denied(owner.call, "POST", write, { driverId: replacement.id });

      await failsWith(replace(schedule.id, replacement.id, manager, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);

      await ok(replace(schedule.id, replacement.id, admin)); // Admin has full access
      await ok(replace(schedule.id, set.driverId, manager)); // so does the manager
      await ok(candidates(schedule.id, admin));
    });
  } finally {
    // Records are never deleted: test data is archived and accounts deactivated.
    if (admin) {
      for (const kind of ["buses", "drivers", "routes"]) {
        for (const id of created[kind]) await admin("POST", `/${kind}/${id}/archive`);
      }
      for (const id of created.accounts) {
        await admin("PATCH", `/accounts/${id}/status`, { isActive: false });
      }
    }
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});