import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { pool } from "../../database/db.js";
import { setScheduleNotifier } from "./index.js";
import { cancelSchedule, createSchedule, startTrip, updateSchedule } from "./service.js";

// Unit tests with a fake database. Constraint, locking and concurrency behaviour
// is covered against PostgreSQL in scheduling.integration.test.js.
const actor = { actorId: "7", actorEmail: "manager@example.com" };
const input = {
  travelDate: "2027-03-15", departureTime: "08:00", arrivalTime: "12:00",
  busId: "1", driverId: "2", routeId: "3",
};

function scheduleRow(overrides = {}) {
  return {
    id: "9", travel_date: "2027-03-15", departure_time: "08:00", arrival_time: "12:00",
    bus_id: "1", driver_id: "2", route_id: "3", status: "scheduled",
    started_at: null, completed_at: null, cancelled_at: null,
    created_at: new Date(), updated_at: new Date(), ...overrides,
  };
}

const RECORDS = {
  fleet_buses: {
    id: "1", bus_number: "B-1", status: "active", required_license_category: "HTV", is_archived: false,
  },
  routes_routes: { id: "3", route_code: "R-1", status: "unblocked", is_archived: false },
  drivers_drivers: {
    id: "2", full_name: "Ali", status: "available", license_category: "HTV",
    license_expiry_date: "2030-01-01", is_archived: false,
  },
};

// `handler` may return a result for a statement; otherwise eligible records are returned.
function useClient(t, handler = () => null) {
  const client = {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      const custom = handler(sql, values);
      if (custom) return custom;
      if (/INSERT INTO scheduling_schedules/.test(sql)) return { rows: [scheduleRow()] };
      const table = Object.keys(RECORDS).find((name) => sql.includes(`FROM ${name}`));
      return { rows: table ? [RECORDS[table]] : [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  return client;
}

function useNotifier(t, handler) {
  const events = [];
  setScheduleNotifier(handler ?? ((event) => events.push(event)));
  t.after(() => setScheduleNotifier());
  return events;
}

const sqls = (client) => client.calls.map((call) => call.sql);
const position = (client, pattern) => sqls(client).findIndex((sql) => pattern.test(sql));
const fail = (code, constraint) => Object.assign(new Error(code), { code, constraint });

test("create locks and checks every record, inserts and audits in one transaction", async (t) => {
  const client = useClient(t);
  const events = useNotifier(t);
  const created = await createSchedule({ input, ...actor });
  assert.equal(created.id, "9");
  assert.equal(created.arrivalDate, "2027-03-15");
  assert.equal(sqls(client)[0], "BEGIN");
  const insert = position(client, /INSERT INTO scheduling_schedules/);
  for (const table of ["fleet_buses", "routes_routes", "drivers_drivers"]) {
    const lock = position(client, new RegExp(`FROM ${table} WHERE id = \\$1 FOR SHARE`));
    assert.ok(lock > 0 && lock < insert, table);
  }
  assert.ok(insert < position(client, /INSERT INTO audit_logs/));
  assert.equal(sqls(client).at(-1), "COMMIT");
  await tick();
  assert.deepEqual(events, [
    { type: "schedule.assigned", scheduleId: "9", driverId: "2", previousDriverId: null },
  ]);
});

test("a failed audit write rolls back and notifies nobody", async (t) => {
  const client = useClient(t, (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
    return null;
  });
  const events = useNotifier(t);
  await assert.rejects(createSchedule({ input, ...actor }), /audit down/);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  assert.equal(sqls(client).includes("COMMIT"), false);
  await tick();
  assert.deepEqual(events, []);
});

test("a failing or hanging notifier never fails the operation", async (t) => {
  useClient(t);
  t.mock.method(console, "warn", () => {});
  for (const handler of [
    () => { throw new Error("sync"); },
    async () => { throw new Error("async"); },
    () => new Promise(() => {}),
  ]) {
    useNotifier(t, handler);
    assert.equal((await createSchedule({ input, ...actor })).id, "9");
    await tick();
  }
});

test("exclusion violations become conflict codes without a retry", async (t) => {
  for (const [constraint, code] of [
    ["scheduling_schedules_bus_overlap", "SCHEDULE_BUS_CONFLICT"],
    ["scheduling_schedules_driver_overlap", "SCHEDULE_DRIVER_CONFLICT"],
  ]) {
    const client = useClient(t, (sql) => {
      if (sql.includes("INSERT INTO scheduling_schedules")) throw fail("23P01", constraint);
      return null;
    });
    await assert.rejects(createSchedule({ input, ...actor }), { code, status: 409 });
    assert.equal(sqls(client).filter((sql) => sql === "BEGIN").length, 1);
    t.mock.restoreAll();
  }
});

test("a deadlock is retried, and repeated deadlocks give a 409", async (t) => {
  let failures = 1;
  const client = useClient(t, (sql) => {
    if (sql.includes("INSERT INTO scheduling_schedules") && failures-- > 0) throw fail("40P01");
    return null;
  });
  assert.equal((await createSchedule({ input, ...actor })).id, "9");
  assert.equal(sqls(client).filter((sql) => sql === "BEGIN").length, 2);

  failures = Infinity;
  client.calls.length = 0;
  await assert.rejects(createSchedule({ input, ...actor }),
    { code: "SCHEDULE_CONCURRENT_UPDATE", status: 409 });
  assert.equal(sqls(client).filter((sql) => sql === "BEGIN").length, 3);
});

test("unrelated database errors are not retried or rewritten", async (t) => {
  const client = useClient(t, (sql) => {
    if (sql.includes("INSERT INTO scheduling_schedules")) throw fail("23514", "other");
    return null;
  });
  await assert.rejects(createSchedule({ input, ...actor }), { code: "23514" });
  assert.equal(sqls(client).filter((sql) => sql === "BEGIN").length, 1);
});

test("an unchanged update writes nothing, rechecks nothing and notifies nobody", async (t) => {
  const client = useClient(t, (sql) =>
    (sql.includes("FROM scheduling_schedules") ? { rows: [scheduleRow()] } : null));
  const events = useNotifier(t);
  await updateSchedule({ id: "9", input: { driverId: "2", departureTime: "08:00" }, ...actor });
  assert.equal(position(client, /^\s*(UPDATE|INSERT)/), -1);
  assert.equal(position(client, /FOR SHARE/), -1);
  await tick();
  assert.deepEqual(events, []);
});

test("a change of driver reports the previous driver after commit", async (t) => {
  useClient(t, (sql) => {
    if (/^UPDATE scheduling_schedules/.test(sql)) return { rows: [scheduleRow({ driver_id: "4" })] };
    if (sql.includes("FROM scheduling_schedules")) return { rows: [scheduleRow()] };
    return null;
  });
  const events = useNotifier(t);
  await updateSchedule({ id: "9", input: { driverId: "4" }, ...actor });
  await tick();
  assert.deepEqual(events, [
    { type: "schedule.changed", scheduleId: "9", driverId: "4", previousDriverId: "2" },
  ]);
});

test("cancel notifies; start does not", async (t) => {
  let status = "scheduled";
  useClient(t, (sql, values) => {
    if (/^UPDATE scheduling_schedules/.test(sql)) return { rows: [scheduleRow({ status: values[0] })] };
    if (sql.includes("FROM scheduling_schedules")) return { rows: [scheduleRow({ status })] };
    return null;
  });
  const events = useNotifier(t);
  await startTrip({ id: "9", ...actor });
  await tick();
  assert.deepEqual(events, []);
  await cancelSchedule({ id: "9", ...actor });
  await tick();
  assert.equal(events[0].type, "schedule.cancelled");
  status = "completed";
  await assert.rejects(startTrip({ id: "9", ...actor }), { code: "INVALID_SCHEDULE_TRANSITION" });
});
