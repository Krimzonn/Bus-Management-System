import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import { createSchedule } from "./service.js";

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

test("scheduling against PostgreSQL", { skip: !email || !password }, async (t) => {
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
      const userEmail = `it-sched-${role ?? "none"}-${stamp}-${sequence += 1}@example.com`;
      const { id } = await ok(admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD }), 201);
      created.accounts.push(id);
      if (role) await ok(admin("PUT", `/accounts/${id}/role`, { role }));
      return { id, call: await openSession(base, userEmail, TEMP_PASSWORD) };
    }
    const manager = (await account("transportation_manager")).call;

    async function newBus(overrides = {}) {
      const bus = await ok(manager("POST", "/buses", {
        busNumber: `S${stamp}-${sequence += 1}`, seatingCapacity: 40, requiredLicenseCategory: "HTV",
        ...overrides,
      }), 201);
      created.buses.push(bus.id);
      return bus;
    }
    async function newDriver(overrides = {}) {
      const n = sequence += 1;
      const driver = await ok(manager("POST", "/drivers", {
        fullName: `Schedule Driver ${stamp} ${n}`, licenseNumber: `SD-${stamp}-${n}`,
        licenseCategory: "HTV", licenseExpiryDate: addDays(day, 3000), ...overrides,
      }), 201);
      created.drivers.push(driver.id);
      return driver;
    }
    async function newRoute(overrides = {}) {
      const route = await ok(manager("POST", "/routes", {
        routeCode: `SR${stamp}-${sequence += 1}`, name: "Test", origin: "A", destination: "B", ...overrides,
      }), 201);
      created.routes.push(route.id);
      return route;
    }
    // A bus, driver and route that no other trip uses.
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
    const book = (body, session = manager) => session("POST", "/schedules", body);
    const booked = (body) => ok(book(body), 201);
    const act = (id, action, session = manager) => session("POST", `/schedules/${id}/${action}`);
    const countFor = async (column, id) => Number((await pool.query(
      `SELECT COUNT(*) FROM scheduling_schedules WHERE ${column} = $1`, [id],
    )).rows[0].count);
    const auditFor = async (entityType, entityId) =>
      (await ok(admin("GET", `/audit?entityType=${entityType}&entityId=${entityId}&limit=100`))).items;

    await t.test("create, view, list, filter, edit, start and complete", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      assert.equal(schedule.status, "scheduled");
      assert.equal(schedule.travelDate, day);
      assert.equal(schedule.departureTime, "10:00");
      assert.equal(schedule.arrivalTime, "14:00");
      assert.equal(schedule.arrivalDate, day);
      assert.equal(schedule.bus.id, set.busId);
      assert.equal(schedule.route.id, set.routeId);
      assert.deepEqual(Object.keys(schedule.driver).sort(), ["fullName", "id"]);
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);

      const later = await booked(trip(set, { travelDate: addDays(day, 1), departureTime: "07:00", arrivalTime: "08:00" }));
      const list = await ok(manager("GET", `/schedules?busId=${set.busId}`));
      assert.deepEqual(list.items.map((s) => s.id), [schedule.id, later.id]);
      assert.equal(list.total, 2);
      const ids = async (query) =>
        (await ok(manager("GET", `/schedules?busId=${set.busId}&${query}`))).items.map((s) => s.id);
      assert.deepEqual(await ids(`dateFrom=${day}&dateTo=${day}`), [schedule.id]);
      assert.deepEqual(await ids(`dateFrom=${addDays(day, 1)}`), [later.id]);
      assert.deepEqual(await ids(`dateTo=${addDays(day, -1)}`), []);
      assert.deepEqual(await ids(`driverId=${set.driverId}&routeId=${set.routeId}&status=scheduled`),
        [schedule.id, later.id]);
      assert.deepEqual(await ids("status=completed"), []);
      assert.deepEqual(await ids("limit=1&page=2"), [later.id]);

      const edited = await ok(manager("PUT", `/schedules/${schedule.id}`, { departureTime: "09:30", arrivalTime: "13:00" }));
      assert.equal(edited.departureTime, "09:30");
      assert.equal(edited.busId, set.busId);

      await failsWith(act(schedule.id, "complete"), 409, "INVALID_SCHEDULE_TRANSITION");
      const started = await ok(act(schedule.id, "start"));
      assert.equal(started.status, "in_progress");
      assert.ok(started.startedAt);
      await failsWith(act(schedule.id, "start"), 409, "INVALID_SCHEDULE_TRANSITION");
      await failsWith(act(schedule.id, "cancel"), 409, "INVALID_SCHEDULE_TRANSITION");
      await failsWith(manager("PUT", `/schedules/${schedule.id}`, { arrivalTime: "15:00" }), 409, "SCHEDULE_NOT_EDITABLE");
      const done = await ok(act(schedule.id, "complete"));
      assert.equal(done.status, "completed");
      assert.ok(done.completedAt);
      for (const action of ["start", "complete", "cancel"]) {
        await failsWith(act(schedule.id, action), 409, "INVALID_SCHEDULE_TRANSITION");
      }
      await failsWith(manager("PUT", `/schedules/${schedule.id}`, { arrivalTime: "15:00" }), 409, "SCHEDULE_NOT_EDITABLE");

      const cancelled = await ok(act(later.id, "cancel"));
      assert.equal(cancelled.status, "cancelled");
      assert.ok(cancelled.cancelledAt);
      for (const action of ["start", "complete", "cancel"]) {
        await failsWith(act(later.id, action), 409, "INVALID_SCHEDULE_TRANSITION");
      }
      await failsWith(manager("PUT", `/schedules/${later.id}`, { arrivalTime: "15:00" }), 409, "SCHEDULE_NOT_EDITABLE");
      // History is kept and there is no delete endpoint.
      assert.equal((await manager("DELETE", `/schedules/${later.id}`)).status, 404);
      assert.equal(await countFor("bus_id", set.busId), 2);

      const actions = (await auditFor("schedule", schedule.id)).map((e) => e.action).sort();
      assert.deepEqual(actions, ["schedule.completed", "schedule.created", "schedule.started", "schedule.updated"]);
      assert.deepEqual((await auditFor("schedule", later.id)).map((e) => e.action).sort(),
        ["schedule.cancelled", "schedule.created"]);
    });

    await t.test("status does not change with time", async () => {
      const past = await booked(trip(await newSet(), { travelDate: "2020-01-01" }));
      assert.equal((await ok(manager("GET", `/schedules/${past.id}`))).status, "scheduled");
    });

    await t.test("invalid requests", async () => {
      const set = await newSet();
      for (const [overrides, code] of [
        [{ departureTime: "10:00", arrivalTime: "10:00" }, "INVALID_TRIP_TIMES"],
        [{ departureTime: "24:00" }, "INVALID_DEPARTURE_TIME"],
        [{ arrivalTime: "14:00:30" }, "INVALID_ARRIVAL_TIME"],
        [{ travelDate: "2027-02-30" }, "INVALID_TRAVEL_DATE"],
        [{ busId: "abc" }, "INVALID_BUS_ID"],
        [{ status: "completed" }, "INVALID_INPUT"],
      ]) await failsWith(book(trip(set, overrides)), 400, code);
      await failsWith(manager("GET", "/schedules/abc"), 400, "INVALID_SCHEDULE_ID");
      await failsWith(manager("GET", "/schedules/999999999"), 404, "SCHEDULE_NOT_FOUND");
      await failsWith(manager("PUT", "/schedules/999999999", { arrivalTime: "15:00" }), 404, "SCHEDULE_NOT_FOUND");
      await failsWith(act("999999999", "start"), 404, "SCHEDULE_NOT_FOUND");
      await failsWith(manager("GET", "/schedules?status=late"), 400, "INVALID_SCHEDULE_FILTER");
      assert.equal(await countFor("bus_id", set.busId), 0);

      const schedule = await booked(trip(set));
      // Equality is checked against the stored value when only one time is sent.
      await failsWith(manager("PUT", `/schedules/${schedule.id}`, { arrivalTime: "10:00" }), 400, "INVALID_TRIP_TIMES");
      await failsWith(manager("PUT", `/schedules/${schedule.id}`, { status: "completed" }), 400, "INVALID_INPUT");
    });

    await t.test("bus defaults apply at creation, can be overridden and are validated", async () => {
      const set = await newSet();
      const other = await newSet();
      const bus = await ok(manager("PUT", `/buses/${set.busId}`, {
        defaultRouteId: set.routeId, defaultDriverId: set.driverId,
      }));
      assert.deepEqual([bus.defaultRouteId, bus.defaultDriverId], [set.routeId, set.driverId]);
      const times = (hour) => ({ departureTime: `${hour}:00`, arrivalTime: `${hour}:30` });
      const only = { busId: set.busId };

      const defaulted = await booked(trip(only, times("01")));
      assert.deepEqual([defaulted.routeId, defaulted.driverId], [set.routeId, set.driverId]);
      const overridden = await booked(trip(only, {
        ...times("02"), routeId: other.routeId, driverId: other.driverId,
      }));
      assert.deepEqual([overridden.routeId, overridden.driverId], [other.routeId, other.driverId]);
      const mixed = await booked(trip(only, { ...times("03"), driverId: other.driverId, routeId: null }));
      assert.deepEqual([mixed.routeId, mixed.driverId], [set.routeId, other.driverId]);

      // Changing the defaults never changes existing schedules.
      await ok(manager("PUT", `/buses/${set.busId}`, { defaultRouteId: other.routeId }));
      assert.equal((await ok(manager("GET", `/schedules/${defaulted.id}`))).routeId, set.routeId);

      // A stale default is rejected when used, but an override still works.
      await ok(manager("PATCH", `/routes/${other.routeId}/status`, { status: "blocked" }));
      await failsWith(book(trip(only, times("04"))), 409, "ROUTE_BLOCKED");
      await booked(trip(only, { ...times("04"), routeId: set.routeId }));
      await ok(manager("PUT", `/buses/${set.busId}`, { defaultRouteId: set.routeId, defaultDriverId: "999999999" }));
      await failsWith(book(trip(only, times("05"))), 404, "DRIVER_NOT_FOUND");
      await booked(trip(only, { ...times("05"), driverId: set.driverId }));

      const cleared = await ok(manager("PUT", `/buses/${set.busId}`, { defaultRouteId: null, defaultDriverId: null }));
      assert.deepEqual([cleared.defaultRouteId, cleared.defaultDriverId], [null, null]);
      await failsWith(book(trip(only, times("06"))), 400, "ROUTE_REQUIRED");
      await failsWith(book(trip(only, { ...times("06"), routeId: set.routeId })), 400, "DRIVER_REQUIRED");

      const audit = await auditFor("bus", set.busId);
      assert.ok(audit.some((e) => e.action === "bus.updated" && e.after_data.defaultDriverId === set.driverId));
    });

    await t.test("ineligible bus, route and driver are rejected on create and on edit", async () => {
      const good = await newSet();
      const schedule = await booked(trip(good));
      const free = trip(await newSet(), { travelDate: addDays(day, 5) });

      async function rejected(overrides, status, code) {
        await failsWith(book({ ...free, ...overrides }), status, code);
        await failsWith(manager("PUT", `/schedules/${schedule.id}`, overrides), status, code);
      }
      for (const [busStatus, code] of [["inactive", "BUS_INACTIVE"], ["under_maintenance", "BUS_UNDER_MAINTENANCE"]]) {
        const bus = await newBus({ status: busStatus });
        await rejected({ busId: bus.id }, 409, code);
      }
      const archivedBus = await newBus();
      await ok(manager("POST", `/buses/${archivedBus.id}/archive`));
      await rejected({ busId: archivedBus.id }, 409, "BUS_ARCHIVED");
      await rejected({ busId: "999999999" }, 404, "BUS_NOT_FOUND");

      const blocked = await newRoute({ status: "blocked" });
      await rejected({ routeId: blocked.id }, 409, "ROUTE_BLOCKED");
      const archivedRoute = await newRoute();
      await ok(manager("POST", `/routes/${archivedRoute.id}/archive`));
      await rejected({ routeId: archivedRoute.id }, 409, "ROUTE_ARCHIVED");
      await rejected({ routeId: "999999999" }, 404, "ROUTE_NOT_FOUND");

      for (const [driverStatus, code] of [["on_leave", "DRIVER_ON_LEAVE"], ["absent", "DRIVER_ABSENT"]]) {
        await rejected({ driverId: (await newDriver({ status: driverStatus })).id }, 409, code);
      }
      const archivedDriver = await newDriver();
      await ok(manager("POST", `/drivers/${archivedDriver.id}/archive`));
      await rejected({ driverId: archivedDriver.id }, 409, "DRIVER_ARCHIVED");
      await rejected({ driverId: "999999999" }, 404, "DRIVER_NOT_FOUND");
      const ltv = await newDriver({ licenseCategory: "LTV" });
      await rejected({ driverId: ltv.id }, 409, "LICENSE_CATEGORY_MISMATCH");
      const ltvBus = await newBus({ requiredLicenseCategory: "LTV" });
      await rejected({ busId: ltvBus.id }, 409, "LICENSE_CATEGORY_MISMATCH");

      // Nothing was saved or changed by any rejected request.
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);
      assert.equal(await countFor("bus_id", free.busId), 0);
      assert.equal((await auditFor("schedule", schedule.id)).length, 1);
    });

    await t.test("license expiry is checked on the travel date", async () => {
      const set = await newSet();
      const driverId = (await newDriver({ licenseExpiryDate: day })).id;
      const mine = { ...set, driverId };
      await booked(trip(mine, { travelDate: addDays(day, -1) }));
      // Valid through the whole expiry date, including a trip arriving the next day.
      const onExpiry = await booked(trip(mine, { departureTime: "22:00", arrivalTime: "02:00" }));
      await failsWith(book(trip(mine, { travelDate: addDays(day, 1), departureTime: "15:00", arrivalTime: "16:00" })),
        409, "LICENSE_EXPIRED");
      await failsWith(manager("PUT", `/schedules/${onExpiry.id}`, { travelDate: addDays(day, 1) }), 409, "LICENSE_EXPIRED");
    });

    await t.test("editing revalidates the unchanged parts of the assignment", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      await ok(manager("PATCH", `/buses/${set.busId}/status`, { status: "under_maintenance" }));
      await failsWith(manager("PUT", `/schedules/${schedule.id}`, { arrivalTime: "15:00" }), 409, "BUS_UNDER_MAINTENANCE");
      const replacement = await newBus();
      const moved = await ok(manager("PUT", `/schedules/${schedule.id}`, { busId: replacement.id, arrivalTime: "15:00" }));
      assert.equal(moved.busId, replacement.id);
      assert.equal(moved.driverId, set.driverId);
      const audit = await auditFor("schedule", schedule.id);
      const entry = (action) => audit.find((e) => e.action === action);
      assert.deepEqual(entry("schedule.assignment_changed").before_data, { busId: set.busId });
      assert.deepEqual(entry("schedule.assignment_changed").after_data, { busId: replacement.id });
      assert.deepEqual(entry("schedule.updated").after_data, { arrivalTime: "15:00" });
      // A later status change does not alter saved trips, which can still be operated (D-05).
      await ok(manager("PATCH", `/buses/${replacement.id}/status`, { status: "inactive" }));
      await ok(act(schedule.id, "start"));
    });

    await t.test("overlap matrix for the same bus and for the same driver", async () => {
      const cases = [
        ["same time", "10:00", "14:00", true],
        ["overlaps the start", "08:00", "10:01", true],
        ["overlaps the end", "13:59", "16:00", true],
        ["contained", "11:00", "12:00", true],
        ["containing", "09:00", "15:00", true],
        ["same start", "10:00", "10:01", true],
        ["same end", "13:59", "14:00", true],
        ["ends at the departure", "08:00", "10:00", false],
        ["starts at the arrival", "14:00", "16:00", false],
        ["ends one minute before", "08:00", "09:59", false],
        ["starts one minute after", "14:01", "16:00", false],
      ];
      for (const [shared, code] of [["busId", "SCHEDULE_BUS_CONFLICT"], ["driverId", "SCHEDULE_DRIVER_CONFLICT"]]) {
        for (const [name, departureTime, arrivalTime, conflicts] of cases) {
          const first = await newSet();
          await booked(trip(first));
          const second = { ...(await newSet()), [shared]: first[shared] };
          const res = await book(trip(second, { departureTime, arrivalTime }));
          assert.equal(res.status, conflicts ? 409 : 201, `${shared}: ${name} ${JSON.stringify(res.body)}`);
          if (conflicts) assert.equal(res.body.code, code, name);
        }
      }
      // The same route at the same time is not a conflict.
      const first = await newSet();
      await booked(trip(first));
      await booked(trip({ ...(await newSet()), routeId: first.routeId }));
    });

    await t.test("overnight and cross-date intervals", async () => {
      // Each case is checked against a trip from 22:00 on `date` to 02:00 next day.
      for (const date of [addDays(day, 10), "2027-12-31", "2028-02-28"]) {
        const next = addDays(date, 1);
        for (const [travelDate, departureTime, arrivalTime, conflicts] of [
          [date, "23:00", "23:30", true],
          [next, "00:00", "01:00", true],
          [next, "01:59", "03:00", true],
          [date, "21:00", "22:01", true],
          [date, "23:00", "01:00", true],
          [addDays(date, -1), "23:00", "22:30", true],
          [next, "02:00", "03:00", false],
          [date, "20:00", "22:00", false],
          [date, "00:00", "02:00", false],
          [next, "22:00", "02:00", false],
          [addDays(date, -1), "22:00", "02:00", false],
        ]) {
          const set = await newSet();
          const night = await booked(trip(set, { travelDate: date, departureTime: "22:00", arrivalTime: "02:00" }));
          assert.equal(night.arrivalDate, next);
          const res = await book(trip(set, { travelDate, departureTime, arrivalTime }));
          assert.equal(res.status, conflicts ? 409 : 201,
            `${date}: ${travelDate} ${departureTime}-${arrivalTime} ${JSON.stringify(res.body)}`);
        }
      }
      // An arrival one minute "before" departure spans almost 24 hours.
      const set = await newSet();
      await booked(trip(set, { departureTime: "10:00", arrivalTime: "09:59" }));
      await failsWith(book(trip(set, { travelDate: addDays(day, 1), departureTime: "09:00", arrivalTime: "09:30" })),
        409, "SCHEDULE_BUS_CONFLICT");
      await booked(trip(set, { travelDate: addDays(day, 1), departureTime: "09:59", arrivalTime: "11:00" }));
      // The database computes the same half-open range.
      const { rows } = await pool.query(
        `SELECT trip_period::text AS period FROM scheduling_schedules
         WHERE bus_id = $1 ORDER BY id LIMIT 1`, [set.busId],
      );
      assert.equal(rows[0].period, `["${day} 10:00:00","${addDays(day, 1)} 09:59:00")`);
    });

    await t.test("editing detects conflicts but never conflicts with itself", async () => {
      const set = await newSet();
      const first = await booked(trip(set));
      const second = await booked(trip(set, { departureTime: "15:00", arrivalTime: "17:00" }));
      await failsWith(manager("PUT", `/schedules/${second.id}`, { departureTime: "13:00" }), 409, "SCHEDULE_BUS_CONFLICT");
      assert.deepEqual(await ok(manager("GET", `/schedules/${second.id}`)), second);
      await ok(manager("PUT", `/schedules/${second.id}`, { departureTime: "14:00" }));
      await ok(manager("PUT", `/schedules/${first.id}`, { departureTime: "11:00", arrivalTime: "13:00" }));
      const other = await booked(trip(await newSet()));
      await failsWith(manager("PUT", `/schedules/${other.id}`, { driverId: set.driverId }), 409, "SCHEDULE_DRIVER_CONFLICT");
    });

    await t.test("cancelled and completed trips do not block; in-progress trips do", async () => {
      const set = await newSet();
      const first = await booked(trip(set));
      await ok(act(first.id, "cancel"));
      const second = await booked(trip(set));
      await ok(act(second.id, "start"));
      await failsWith(book(trip(set)), 409, "SCHEDULE_BUS_CONFLICT");
      await ok(act(second.id, "complete"));
      await booked(trip(set));
      assert.equal(await countFor("bus_id", set.busId), 3);
    });

    await t.test("history stays readable after records are archived", async () => {
      const set = await newSet();
      const schedule = await booked(trip(set));
      await ok(act(schedule.id, "cancel"));
      await ok(manager("POST", `/buses/${set.busId}/archive`));
      await ok(manager("POST", `/drivers/${set.driverId}/archive`));
      await ok(manager("POST", `/routes/${set.routeId}/archive`));
      const read = await ok(manager("GET", `/schedules/${schedule.id}`));
      assert.equal(read.bus.id, set.busId);
      assert.equal(read.driver.id, set.driverId);
      assert.equal(read.route.id, set.routeId);
    });

    await t.test("concurrent conflicting creations: exactly one succeeds", async () => {
      for (const shared of ["busId", "driverId"]) {
        for (let round = 0; round < 5; round += 1) {
          const first = await newSet();
          const rivals = [first];
          for (let i = 0; i < 5; i += 1) rivals.push({ ...(await newSet()), [shared]: first[shared] });
          const results = await Promise.all(rivals.map((set, i) =>
            book(trip(set, { departureTime: `10:0${i}` }))));
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409],
            JSON.stringify(results.map((r) => r.body)));
          const column = shared === "busId" ? "bus_id" : "driver_id";
          assert.equal(await countFor(column, first[shared]), 1);
        }
      }
    });

    await t.test("concurrent crossed bus and driver conflicts never error or overlap", async () => {
      for (let round = 0; round < 10; round += 1) {
        const a = await newSet();
        const b = await newSet();
        const c = { ...(await newSet()), busId: a.busId, driverId: b.driverId };
        const d = { ...(await newSet()), busId: b.busId, driverId: a.driverId };
        const results = await Promise.all([a, b, c, d].map((set) => book(trip(set))));
        for (const res of results) assert.ok([201, 409].includes(res.status), JSON.stringify(res.body));
        assert.ok(results.some((r) => r.status === 201));
        for (const column of ["bus_id", "driver_id"]) {
          for (const id of column === "bus_id" ? [a.busId, b.busId] : [a.driverId, b.driverId]) {
            assert.ok(await countFor(column, id) <= 1);
          }
        }
      }
    });

    await t.test("concurrent edits into the same slot: only one succeeds", async () => {
      for (let round = 0; round < 5; round += 1) {
        const target = await newBus();
        const schedules = [];
        for (let i = 0; i < 4; i += 1) schedules.push(await booked(trip(await newSet())));
        const results = await Promise.all(schedules.map((s) =>
          manager("PUT", `/schedules/${s.id}`, { busId: target.id })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409],
          JSON.stringify(results.map((r) => r.body)));
        assert.equal(await countFor("bus_id", target.id), 1);
      }
    });

    await t.test("concurrent actions on one trip apply once", async () => {
      for (let round = 0; round < 5; round += 1) {
        const schedule = await booked(trip(await newSet()));
        const results = await Promise.all(["start", "start", "cancel", "cancel"].map((a) => act(schedule.id, a)));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
        assert.equal((await auditFor("schedule", schedule.id)).length, 2);
      }
    });

    await t.test("an uncommitted status change blocks creation until it is decided", async () => {
      for (const [table, key, sql, code] of [
        ["fleet_buses", "busId", "status = 'inactive'", "BUS_INACTIVE"],
        ["routes_routes", "routeId", "status = 'blocked'", "ROUTE_BLOCKED"],
        ["drivers_drivers", "driverId", "status = 'absent'", "DRIVER_ABSENT"],
      ]) {
        const set = await newSet();
        const other = await pool.connect();
        let pending;
        try {
          await other.query("BEGIN");
          await other.query(`UPDATE ${table} SET ${sql} WHERE id = $1`, [set[key]]);
          let settled = false;
          pending = book(trip(set)).finally(() => { settled = true; });
          await new Promise((resolve) => setTimeout(resolve, 400));
          assert.equal(settled, false, `${table}: creation did not wait`);
          await other.query("COMMIT");
        } finally {
          other.release();
        }
        await failsWith(pending, 409, code);
      }
    });

    await t.test("a failed audit write leaves no schedule behind", async () => {
      const set = await newSet();
      await assert.rejects(
        createSchedule({ input: trip(set), actorId: "1", actorEmail: "not-an-email" }),
        /INVALID_AUDIT_ACTOR/,
      );
      assert.equal(await countFor("bus_id", set.busId), 0);
    });

    await t.test("management permissions", async () => {
      const schedule = await booked(trip(await newSet()));
      const free = trip(await newSet());
      const reads = ["/schedules", `/schedules/${schedule.id}`];
      const writes = [
        ["POST", "/schedules", free],
        ["PUT", `/schedules/${schedule.id}`, { arrivalTime: "15:00" }],
        ["POST", `/schedules/${schedule.id}/start`],
        ["POST", `/schedules/${schedule.id}/complete`],
        ["POST", `/schedules/${schedule.id}/cancel`],
      ];
      const own = [
        ["GET", "/schedules/mine"],
        ["GET", `/schedules/mine/${schedule.id}`],
        ["POST", `/schedules/mine/${schedule.id}/start`],
        ["POST", `/schedules/mine/${schedule.id}/complete`],
      ];
      const denied = (session, method, path, body) =>
        failsWith(session(method, path, body), 403, "INSUFFICIENT_PERMISSION");

      for (const [method, path] of [...reads.map((p) => ["GET", p]), ...writes, ...own]) {
        assert.equal((await fetch(`${base}${path}`, { method })).status, 401, `${method} ${path}`);
      }
      const staff = (await account("administrative_staff")).call;
      for (const path of reads) await ok(staff("GET", path));
      for (const write of writes) await denied(staff, ...write);
      for (const request of own) await denied(staff, ...request);
      for (const role of ["applicant", "passenger", null]) {
        const session = (await account(role)).call;
        for (const path of reads) await denied(session, "GET", path);
        for (const request of [...writes, ...own]) await denied(session, ...request);
      }
      // Managers and Admin do not use the driver-only endpoints.
      for (const session of [manager, admin]) {
        for (const request of own) await denied(session, ...request);
      }
      for (const [method, path, body] of writes) {
        await failsWith(manager(method, path, body, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      }
      assert.deepEqual(await ok(manager("GET", `/schedules/${schedule.id}`)), schedule);
      // Admin has full access.
      await ok(admin("PUT", `/schedules/${schedule.id}`, { arrivalTime: "15:00" }));
      await ok(act(schedule.id, "start", admin));
      await ok(act(schedule.id, "complete", admin));
    });

    await t.test("driver account links", async () => {
      const driver = await newDriver();
      const second = await newDriver();
      const login = await account("driver");
      const staff = await account("administrative_staff");
      const link = (session, driverId, userId) => session("PUT", `/drivers/${driverId}/account`, { userId });

      for (const session of [manager, staff.call, login.call]) {
        await failsWith(link(session, driver.id, login.id), 403, "INSUFFICIENT_PERMISSION");
        await failsWith(session("GET", `/drivers/${driver.id}/account`), 403, "INSUFFICIENT_PERMISSION");
      }
      await failsWith(admin("PUT", `/drivers/${driver.id}/account`, { userId: login.id }, { csrf: false }),
        403, "CSRF_VALIDATION_FAILED");
      await failsWith(admin("PUT", `/drivers/${driver.id}/account`, {}), 400, "INVALID_ACCOUNT_ID");
      for (const userId of [staff.id, "999999999"]) {
        await failsWith(link(admin, driver.id, userId), 409, "ACCOUNT_NOT_ELIGIBLE_FOR_DRIVER_LINK");
      }
      await failsWith(link(admin, "999999999", login.id), 404, "DRIVER_NOT_FOUND");
      assert.deepEqual(await ok(link(admin, driver.id, login.id)), { driverId: driver.id, userId: login.id });
      await ok(link(admin, driver.id, login.id));
      await failsWith(link(admin, second.id, login.id), 409, "DRIVER_ACCOUNT_ALREADY_LINKED");
      assert.equal((await ok(admin("GET", `/drivers/${driver.id}/account`))).userId, login.id);
      // The existing driver record shape does not expose the link.
      assert.equal("accountUserId" in (await ok(staff.call("GET", `/drivers/${driver.id}`))), false);
      await ok(link(admin, driver.id, null));
      await failsWith(login.call("GET", "/schedules/mine"), 403, "DRIVER_ACCOUNT_NOT_LINKED");
      await ok(link(admin, second.id, login.id));
      assert.equal((await auditFor("driver", driver.id))
        .filter((e) => e.action === "driver.account_link_changed").length, 2);
      await ok(manager("POST", `/drivers/${driver.id}/archive`));
      await failsWith(link(admin, driver.id, (await account("driver")).id), 409, "DRIVER_ARCHIVED");
    });

    await t.test("drivers see and operate only their own trips", async () => {
      const mine = await newSet();
      const theirs = await newSet();
      const me = await account("driver");
      const them = await account("driver");
      const unlinked = await account("driver");
      await ok(admin("PUT", `/drivers/${mine.driverId}/account`, { userId: me.id }));
      await ok(admin("PUT", `/drivers/${theirs.driverId}/account`, { userId: them.id }));
      const own = await booked(trip(mine));
      const foreign = await booked(trip(theirs));

      const list = await ok(me.call("GET", "/schedules/mine"));
      assert.deepEqual(list.items.map((s) => s.id), [own.id]);
      assert.equal(list.total, 1);
      assert.equal((await ok(me.call("GET", `/schedules/mine/${own.id}`))).id, own.id);
      assert.deepEqual((await ok(me.call("GET", `/schedules/mine?dateFrom=${day}&status=scheduled`))).items.length, 1);
      await failsWith(me.call("GET", `/schedules/mine?driverId=${theirs.driverId}`), 400, "INVALID_SCHEDULE_FILTER");
      for (const id of [foreign.id, "999999999"]) {
        await failsWith(me.call("GET", `/schedules/mine/${id}`), 404, "SCHEDULE_NOT_FOUND");
        for (const action of ["start", "complete"]) {
          await failsWith(me.call("POST", `/schedules/mine/${id}/${action}`), 404, "SCHEDULE_NOT_FOUND");
        }
      }
      // No management access, so no assignment edits or cancellation.
      for (const [method, path, body] of [
        ["GET", "/schedules"], ["GET", `/schedules/${own.id}`], ["POST", "/schedules", trip(mine)],
        ["PUT", `/schedules/${own.id}`, { driverId: theirs.driverId }],
        ["POST", `/schedules/${own.id}/cancel`], ["POST", `/schedules/${own.id}/start`],
      ]) await failsWith(me.call(method, path, body), 403, "INSUFFICIENT_PERMISSION");
      assert.equal((await me.call("POST", `/schedules/mine/${own.id}/cancel`)).status, 404);
      assert.equal((await me.call("PUT", `/schedules/mine/${own.id}`, { arrivalTime: "15:00" })).status, 404);

      await failsWith(unlinked.call("GET", "/schedules/mine"), 403, "DRIVER_ACCOUNT_NOT_LINKED");
      await failsWith(unlinked.call("GET", `/schedules/mine/${own.id}`), 403, "DRIVER_ACCOUNT_NOT_LINKED");
      await failsWith(unlinked.call("POST", `/schedules/mine/${own.id}/start`), 403, "DRIVER_ACCOUNT_NOT_LINKED");
      await failsWith(me.call("POST", `/schedules/mine/${own.id}/start`, undefined, { csrf: false }),
        403, "CSRF_VALIDATION_FAILED");

      await failsWith(me.call("POST", `/schedules/mine/${own.id}/complete`), 409, "INVALID_SCHEDULE_TRANSITION");
      assert.equal((await ok(me.call("POST", `/schedules/mine/${own.id}/start`))).status, "in_progress");
      await failsWith(them.call("POST", `/schedules/mine/${own.id}/complete`), 404, "SCHEDULE_NOT_FOUND");
      assert.equal((await ok(me.call("POST", `/schedules/mine/${own.id}/complete`))).status, "completed");
      const audit = await auditFor("schedule", own.id);
      for (const action of ["schedule.started", "schedule.completed"]) {
        assert.equal(String(audit.find((e) => e.action === action).actor_id), me.id);
      }
      assert.deepEqual(await ok(manager("GET", `/schedules/${foreign.id}`)), foreign);

      // Reassignment moves access with the trip.
      const moved = await booked(trip(mine, { travelDate: addDays(day, 2) }));
      await ok(manager("PUT", `/schedules/${moved.id}`, { driverId: theirs.driverId }));
      await failsWith(me.call("GET", `/schedules/mine/${moved.id}`), 404, "SCHEDULE_NOT_FOUND");
      await ok(them.call("GET", `/schedules/mine/${moved.id}`));
    });

    await t.test("database constraints hold even without the application", async () => {
      const set = await newSet();
      await booked(trip(set));
      const insert = (departure, arrival, bus, driver, status = "scheduled") => pool.query(
        `INSERT INTO scheduling_schedules
           (travel_date, departure_time, arrival_time, bus_id, driver_id, route_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [day, departure, arrival, bus, driver, set.routeId, status],
      );
      await assert.rejects(insert("11:00", "12:00", set.busId, "999999991"),
        { code: "23P01", constraint: "scheduling_schedules_bus_overlap" });
      await assert.rejects(insert("11:00", "12:00", "999999992", set.driverId),
        { code: "23P01", constraint: "scheduling_schedules_driver_overlap" });
      await assert.rejects(insert("18:00", "18:00", set.busId, set.driverId), { code: "23514" });
      await assert.rejects(insert("18:00:30", "19:00", set.busId, set.driverId), { code: "23514" });
      await assert.rejects(insert("18:00", "24:00", set.busId, set.driverId), { code: "23514" });
      await assert.rejects(insert("18:00", "19:00", set.busId, set.driverId, "delayed"), { code: "23514" });
      await assert.rejects(insert("18:00", "19:00", set.busId, set.driverId, "completed"), { code: "23514" });
    });

    const { rows } = await pool.query("SELECT current_user AS role");
    await t.test("runtime role cannot delete schedules",
      { skip: rows[0].role !== "bus_app" && "DATABASE_URL does not use the bus_app role" }, async () => {
        for (const sql of ["DELETE FROM scheduling_schedules WHERE FALSE", "TRUNCATE scheduling_schedules"]) {
          await assert.rejects(pool.query(sql), { code: "42501" }, sql);
        }
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
