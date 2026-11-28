import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { pool } from "../../database/db.js";
import { ACTIONS } from "../audit/registry.js";
import { setScheduleNotifier } from "./index.js";
import { getReplacementCandidates, replaceDriver } from "./replacement.js";

// Unit tests with a fake database. Constraint, locking and concurrency behaviour
// is covered against PostgreSQL in replacement.integration.test.js.
const actor = { actorId: "7", actorEmail: "manager@example.com" };

const scheduleRow = (o = {}) => ({
  id: "9", travel_date: "2027-03-15", departure_time: "08:00", arrival_time: "12:00",
  bus_id: "1", driver_id: "2", route_id: "3", status: "scheduled",
  started_at: null, completed_at: null, cancelled_at: null,
  created_at: new Date(), updated_at: new Date(), ...o,
});
const busRow = (o = {}) => ({
  id: "1", bus_number: "B-1", status: "active", required_license_category: "HTV", is_archived: false, ...o,
});
const routeRow = (o = {}) => ({
  id: "3", route_code: "R-1", name: "N", origin: "A", destination: "B",
  status: "unblocked", is_archived: false, ...o,
});
const driverRow = (o = {}) => ({
  id: "4", full_name: "Sara Khan", license_number: "L-4", license_category: "HTV",
  license_expiry_date: "2030-01-01", status: "available", is_archived: false, ...o,
});
const defaults = () => ({
  schedule: scheduleRow(), bus: busRow(), route: routeRow(), driver: driverRow(), busy: [], drivers: [],
});

function useClient(t) {
  const client = {
    calls: [],
    state: defaults(),
    async query(sql, values) {
      this.calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      const s = this.state;
      if (s.onQuery) {
        const custom = s.onQuery(sql, values);
        if (custom) return custom;
      }
      if (/^UPDATE scheduling_schedules/.test(sql)) return { rows: [{ ...s.schedule, driver_id: values[0] }] };
      if (sql.includes("FROM scheduling_schedules")) return { rows: s.schedule ? [s.schedule] : [] };
      if (sql.includes("FROM fleet_buses")) return { rows: s.bus ? [s.bus] : [] };
      if (sql.includes("FROM routes_routes")) return { rows: s.route ? [s.route] : [] };
      if (sql.includes("FROM drivers_drivers")) return { rows: s.driver ? [s.driver] : [] };
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  return client;
}

function useNotifier(t) {
  const events = [];
  setScheduleNotifier((event) => events.push(event));
  t.after(() => setScheduleNotifier());
  return events;
}

const sqls = (client) => client.calls.map((c) => c.sql);
const position = (client, pattern) => sqls(client).findIndex((sql) => pattern.test(sql));
const run = (driverId = "4", id = "9") => replaceDriver({ id, input: { driverId }, ...actor });

test("the replacement audit action is registered for schedules and records only the driver", () => {
  assert.equal(ACTIONS["schedule.driver_replaced"].entity, "schedule");
  assert.deepEqual(ACTIONS["schedule.driver_replaced"].fields, ["driverId"]);
});

test("replace revalidates under share locks, changes only the driver, audits and notifies after commit", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  const result = await run();
  assert.equal(result.driverId, "4");
  assert.equal(result.busId, "1");
  assert.equal(result.routeId, "3");
  assert.equal(result.driver.fullName, "Sara Khan");

  assert.equal(sqls(client)[0], "BEGIN");
  const update = position(client, /^UPDATE scheduling_schedules/);
  assert.ok(position(client, /FROM scheduling_schedules WHERE id = \$1 FOR UPDATE/) < update);
  for (const table of ["fleet_buses", "routes_routes", "drivers_drivers"]) {
    const lock = position(client, new RegExp(`FROM ${table} WHERE id = \\$1 FOR SHARE`));
    assert.ok(lock > 0 && lock < update, table);
  }
  const updateCall = client.calls[update];
  assert.match(updateCall.sql.split("WHERE")[0], /driver_id = \$1/);
  assert.doesNotMatch(updateCall.sql.split("WHERE")[0], /bus_id|route_id|travel_date/);
  assert.deepEqual(updateCall.values, ["4", "9"]);

  const audit = client.calls.find((c) => c.sql.includes("INSERT INTO audit_logs")).values;
  assert.ok(update < position(client, /INSERT INTO audit_logs/));
  assert.deepEqual([audit[0], audit[1], audit[2], audit[3], audit[4]],
    ["7", "manager@example.com", "schedule.driver_replaced", "schedule", "9"]);
  assert.deepEqual(JSON.parse(audit[5]), { driverId: "2" });
  assert.deepEqual(JSON.parse(audit[6]), { driverId: "4" });
  assert.equal(sqls(client).at(-1), "COMMIT");

  await tick();
  assert.deepEqual(events, [
    { type: "schedule.replacement_assigned", scheduleId: "9", driverId: "4", previousDriverId: "2" },
  ]);
});

test("choosing the current driver is rejected without writing", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  await assert.rejects(run("2"), { code: "REPLACEMENT_SAME_DRIVER", status: 409 });
  assert.equal(position(client, /^UPDATE scheduling_schedules/), -1);
  await tick();
  assert.deepEqual(events, []);
});

test("an ineligible candidate, bus or route is refused and nothing is written or published", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  for (const [change, code] of [
    [{ driver: driverRow({ status: "on_leave" }) }, "DRIVER_ON_LEAVE"],
    [{ driver: driverRow({ status: "absent" }) }, "DRIVER_ABSENT"],
    [{ driver: driverRow({ is_archived: true }) }, "DRIVER_ARCHIVED"],
    [{ driver: driverRow({ license_expiry_date: "2027-03-14" }) }, "LICENSE_EXPIRED"],
    [{ driver: driverRow({ license_category: "LTV" }) }, "LICENSE_CATEGORY_MISMATCH"],
    [{ bus: busRow({ status: "inactive" }) }, "BUS_INACTIVE"],
    [{ route: routeRow({ status: "blocked" }) }, "ROUTE_BLOCKED"],
  ]) {
    client.calls.length = 0;
    client.state = { ...defaults(), ...change };
    await assert.rejects(run(), { code, status: 409 }, code);
    assert.equal(sqls(client).at(-1), "ROLLBACK", code);
    assert.equal(position(client, /^UPDATE scheduling_schedules/), -1, code);
    assert.equal(position(client, /INSERT INTO audit_logs/), -1, code);
  }
  client.calls.length = 0;
  client.state = { ...defaults(), driver: null };
  await assert.rejects(run(), { code: "DRIVER_NOT_FOUND", status: 404 });
  await tick();
  assert.deepEqual(events, []);
});

test("only a trip that has not started can get a replacement; missing trips are 404", async (t) => {
  const client = useClient(t);
  for (const status of ["in_progress", "completed", "cancelled"]) {
    client.state = { ...defaults(), schedule: scheduleRow({ status }) };
    await assert.rejects(run(), { code: "SCHEDULE_NOT_EDITABLE", status: 409 }, status);
  }
  client.state = { ...defaults(), schedule: null };
  await assert.rejects(run(), { code: "SCHEDULE_NOT_FOUND", status: 404 });
});

test("an overlap found by the database becomes a driver conflict and is not retried", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  client.state.onQuery = (sql) => {
    if (/^UPDATE scheduling_schedules/.test(sql)) {
      throw Object.assign(new Error("overlap"), {
        code: "23P01", constraint: "scheduling_schedules_driver_overlap",
      });
    }
    return null;
  };
  await assert.rejects(run(), { code: "SCHEDULE_DRIVER_CONFLICT", status: 409 });
  assert.equal(sqls(client).filter((sql) => sql === "BEGIN").length, 1);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  await tick();
  assert.deepEqual(events, []);
});

test("a failed audit write rolls the replacement back and publishes nothing", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  client.state.onQuery = (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
    return null;
  };
  await assert.rejects(run(), /audit down/);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  assert.equal(sqls(client).includes("COMMIT"), false);
  await tick();
  assert.deepEqual(events, []);
});

test("invalid input never opens a transaction", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => assert.fail("must not connect"));
  for (const [input, code] of [
    [{}, "INVALID_DRIVER_ID"], [{ driverId: "abc" }, "INVALID_DRIVER_ID"], [{ driverId: "0" }, "INVALID_DRIVER_ID"],
    [{ driverId: null }, "INVALID_DRIVER_ID"], [{ driverId: "4", status: "x" }, "INVALID_INPUT"],
    [null, "INVALID_INPUT"], [[], "INVALID_INPUT"],
  ]) {
    await assert.rejects(replaceDriver({ id: "9", input, ...actor }), { code, status: 400 }, JSON.stringify(input));
  }
  await assert.rejects(replaceDriver({ id: "mine", input: { driverId: "4" }, ...actor }),
    { code: "INVALID_SCHEDULE_ID" });
  assert.equal(connect.mock.callCount(), 0);
});

// ---- suggestions ----

function useDb(t, state) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("trip_period")) return { rows: state.busy.map((id) => ({ driver_id: id })) };
    if (sql.includes("FROM scheduling_schedules")) return { rows: state.schedule ? [state.schedule] : [] };
    if (sql.includes("FROM fleet_buses")) return { rows: [state.bus] };
    if (sql.includes("FROM routes_routes")) return { rows: [state.route] };
    if (sql.includes("FROM drivers_drivers")) return { rows: state.drivers };
    return { rows: [] };
  });
  return calls;
}

test("candidates exclude unqualified and conflicting drivers and explain the counts", async (t) => {
  const calls = useDb(t, {
    ...defaults(),
    drivers: [
      driverRow({ id: "3", full_name: "Eligible" }),
      driverRow({ id: "4", status: "on_leave" }),
      driverRow({ id: "5", full_name: "Busy" }),
      driverRow({ id: "6", status: "absent" }),
      driverRow({ id: "7", license_expiry_date: "2027-03-14" }),
      driverRow({ id: "8", license_category: "LTV" }),
    ],
    busy: ["5"],
  });
  const result = await getReplacementCandidates("9");
  assert.deepEqual(result.candidates, [
    { id: "3", fullName: "Eligible", licenseCategory: "HTV", licenseExpiryDate: "2030-01-01" },
  ]);
  assert.deepEqual(result.summary, {
    evaluated: 6, available: 4, licenseValid: 3, categoryQualified: 2, withoutConflict: 1,
  });
  assert.equal(result.emptyReason, null);
  assert.equal(result.currentDriverId, "2");
  assert.equal(result.travelDate, "2027-03-15");
  // The current driver is excluded and the overlap query is bound to the schedule.
  assert.deepEqual(calls.find((c) => c.sql.includes("FROM drivers_drivers")).values, ["2"]);
  assert.deepEqual(calls.find((c) => c.sql.includes("trip_period")).values, [["3", "4", "5", "6", "7", "8"].filter((id) => ["3", "5"].includes(id)), "9"]);
  // Reading suggestions never writes.
  assert.equal(calls.some((c) => /^\s*(UPDATE|INSERT|DELETE)/.test(c.sql)), false);
});

test("an empty list says why", async (t) => {
  const state = { ...defaults() };
  useDb(t, state);
  const reason = async (drivers, busy = []) => {
    state.drivers = drivers;
    state.busy = busy;
    const result = await getReplacementCandidates("9");
    assert.deepEqual(result.candidates, []);
    return result.emptyReason;
  };
  assert.equal(await reason([]), "NO_ACTIVE_DRIVERS");
  assert.equal(await reason([driverRow({ status: "on_leave" })]), "NO_AVAILABLE_DRIVERS");
  assert.equal(await reason([driverRow({ license_expiry_date: "2027-03-14" })]), "NO_VALID_LICENSE");
  assert.equal(await reason([driverRow({ license_category: "LTV" })]), "NO_CATEGORY_MATCH");
  assert.equal(await reason([driverRow({ id: "3" })], ["3"]), "ALL_HAVE_CONFLICTS");
});

test("nobody is suggested while the bus or route cannot be assigned", async (t) => {
  const state = { ...defaults(), drivers: [driverRow({ id: "3" })] };
  const calls = useDb(t, state);
  state.bus = busRow({ status: "under_maintenance" });
  let result = await getReplacementCandidates("9");
  assert.deepEqual([result.candidates, result.summary, result.emptyReason], [[], null, "BUS_UNDER_MAINTENANCE"]);
  state.bus = busRow();
  state.route = routeRow({ status: "blocked" });
  result = await getReplacementCandidates("9");
  assert.equal(result.emptyReason, "ROUTE_BLOCKED");
  assert.equal(calls.some((c) => c.sql.includes("FROM drivers_drivers")), false);
});

test("suggestions need an existing trip that has not started", async (t) => {
  const state = { ...defaults() };
  useDb(t, state);
  for (const status of ["in_progress", "completed", "cancelled"]) {
    state.schedule = scheduleRow({ status });
    await assert.rejects(getReplacementCandidates("9"), { code: "SCHEDULE_NOT_EDITABLE", status: 409 });
  }
  state.schedule = null;
  await assert.rejects(getReplacementCandidates("9"), { code: "SCHEDULE_NOT_FOUND", status: 404 });
  await assert.rejects(getReplacementCandidates("abc"), { code: "INVALID_SCHEDULE_ID", status: 400 });
});