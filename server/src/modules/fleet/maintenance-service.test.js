import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  archiveMaintenance, classifyMaintenanceDue, createMaintenance, getBusMaintenanceHistory,
  listOverdueMaintenance, listUpcomingMaintenance, updateMaintenance,
} from "./maintenance-service.js";

// Unit tests with a fake database. Real date boundaries, constraints and
// permissions are covered against PostgreSQL in maintenance.integration.test.js.
const actor = { actorId: "7", actorEmail: "staff@example.com" };
const input = {
  busId: "1", serviceDate: "2026-11-01", maintenanceType: "Oil change",
  workDescription: "Changed oil", cost: 150, odometer: 12000, nextServiceDate: "2027-02-01",
};

function row(overrides = {}) {
  return {
    id: "5", bus_id: "1", bus_number: "BUS-101", bus_is_archived: false,
    service_date: "2026-11-01", maintenance_type: "Oil change", work_description: "Changed oil",
    cost: "150.00", odometer: 12000, next_service_date: "2027-02-01",
    created_by: "7", updated_by: "7", archived_by: null, archived_at: null,
    created_at: new Date(), updated_at: new Date(), ...overrides,
  };
}

function useClient(t, handler = () => null) {
  const client = {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      return handler(sql, values) ?? { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  return client;
}

const sqls = (client) => client.calls.map((c) => c.sql);
const position = (client, pattern) => sqls(client).findIndex((s) => pattern.test(s));
const audits = (client) => client.calls
  .filter((c) => c.sql.includes("INSERT INTO audit_logs"))
  .map(({ values }) => ({
    actor: values[0], action: values[2], entity: values[3], id: values[4],
    before: values[5] && JSON.parse(values[5]), after: values[6] && JSON.parse(values[6]),
  }));

const createHandler = (bus = { id: "1", is_archived: false }) => (sql) => {
  if (sql.includes("INSERT INTO fleet_maintenance_records")) return { rows: [{ id: "5" }] };
  if (sql.includes("FROM fleet_buses")) return { rows: bus ? [bus] : [] };
  if (sql.includes("FROM fleet_maintenance_records m")) return { rows: [row()] };
  return null;
};

test("create checks the bus, inserts and audits in one transaction", async (t) => {
  const client = useClient(t, createHandler());
  const record = await createMaintenance({ input, ...actor });
  assert.equal(record.id, "5");
  assert.equal(record.cost, "150.00");
  assert.equal(record.createdBy, "7");
  const order = sqls(client);
  assert.equal(order[0], "BEGIN");
  assert.ok(position(client, /FROM fleet_buses WHERE id = \$1 FOR SHARE/) < position(client, /INSERT INTO fleet_maintenance_records/));
  assert.ok(position(client, /INSERT INTO fleet_maintenance_records/) < position(client, /INSERT INTO audit_logs/));
  assert.equal(order.at(-1), "COMMIT");
  const insert = client.calls.find((c) => c.sql.includes("INSERT INTO fleet_maintenance_records"));
  assert.deepEqual(insert.values, ["1", "2026-11-01", "Oil change", "Changed oil", "150.00", 12000, "2027-02-01", "7"]);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "maintenance.created", entity: "maintenance", id: "5", before: null,
    after: {
      busId: "1", serviceDate: "2026-11-01", maintenanceType: "Oil change", workDescription: "Changed oil",
      cost: "150.00", odometer: 12000, nextServiceDate: "2027-02-01", isArchived: false,
    },
  }]);
});

test("a failed audit write rolls the creation back", async (t) => {
  const handler = createHandler();
  const client = useClient(t, (sql, values) => {
    if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
    return handler(sql, values);
  });
  await assert.rejects(createMaintenance({ input, ...actor }), /audit down/);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  assert.equal(sqls(client).includes("COMMIT"), false);
});

test("a missing or archived bus is refused before anything is written", async (t) => {
  let client = useClient(t, createHandler(null));
  await assert.rejects(createMaintenance({ input, ...actor }), { code: "BUS_NOT_FOUND", status: 404 });
  assert.equal(position(client, /INSERT/), -1);
  t.mock.restoreAll();
  client = useClient(t, createHandler({ id: "1", is_archived: true }));
  await assert.rejects(createMaintenance({ input, ...actor }), { code: "BUS_ARCHIVED", status: 409 });
  assert.equal(position(client, /INSERT/), -1);
});

test("invalid input never opens a transaction", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => assert.fail("must not connect"));
  await assert.rejects(createMaintenance({ input: { ...input, cost: -1 }, ...actor }), { code: "INVALID_COST" });
  await assert.rejects(createMaintenance({ input: { ...input, busId: "abc" }, ...actor }), { code: "INVALID_BUS_ID" });
  await assert.rejects(updateMaintenance({ id: "x", input: { cost: 1 }, ...actor }), { code: "INVALID_MAINTENANCE_ID" });
  assert.equal(connect.mock.callCount(), 0);
});

function lockedClient(t, before, after) {
  let current = before;
  return useClient(t, (sql) => {
    if (sql.startsWith("UPDATE")) { current = after; return { rows: [] }; }
    if (sql.includes("FROM fleet_maintenance_records m")) return { rows: current ? [current] : [] };
    return null;
  });
}

test("update changes and audits only the modified fields and stamps the actor", async (t) => {
  const client = lockedClient(t, row(), row({ cost: "200.00", odometer: null }));
  const updated = await updateMaintenance({
    id: "5", input: { cost: 200, odometer: null, maintenanceType: "Oil change" }, ...actor,
  });
  assert.equal(updated.cost, "200.00");
  const update = client.calls.find((c) => c.sql.startsWith("UPDATE"));
  const setClause = update.sql.split("WHERE")[0];
  assert.match(setClause, /cost = \$1/);
  assert.match(setClause, /odometer = \$2/);
  assert.match(setClause, /updated_by = \$3/);
  assert.doesNotMatch(setClause, /maintenance_type/);
  assert.deepEqual(update.values, ["200.00", null, "7", "5"]);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "maintenance.updated", entity: "maintenance", id: "5",
    before: { cost: "150.00", odometer: 12000 }, after: { cost: "200.00", odometer: null },
  }]);
  assert.equal(sqls(client).at(-1), "COMMIT");
});

test("an update with no real change writes nothing", async (t) => {
  const client = lockedClient(t, row(), row());
  await updateMaintenance({ id: "5", input: { cost: "150", workDescription: "Changed oil" }, ...actor });
  assert.equal(position(client, /^UPDATE|INSERT/), -1);
});

test("update rejects missing and archived records and a next date before the service date", async (t) => {
  let client = lockedClient(t, null, null);
  await assert.rejects(updateMaintenance({ id: "5", input: { cost: 1 }, ...actor }), { code: "MAINTENANCE_NOT_FOUND", status: 404 });
  t.mock.restoreAll();
  client = lockedClient(t, row({ archived_at: new Date(), archived_by: "7" }), null);
  await assert.rejects(updateMaintenance({ id: "5", input: { cost: 1 }, ...actor }), { code: "MAINTENANCE_ARCHIVED", status: 409 });
  t.mock.restoreAll();
  client = lockedClient(t, row(), null);
  await assert.rejects(updateMaintenance({ id: "5", input: { nextServiceDate: "2026-10-31" }, ...actor }),
    { code: "NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE", status: 400 });
  assert.equal(position(client, /^UPDATE/), -1);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
});

test("archive updates (never deletes) and audits; a second archive is rejected", async (t) => {
  const archivedRow = row({ archived_at: new Date(), archived_by: "7" });
  const client = lockedClient(t, row(), archivedRow);
  const archived = await archiveMaintenance({ id: "5", ...actor });
  assert.equal(archived.isArchived, true);
  assert.equal(archived.dueStatus, "none");
  assert.equal(sqls(client).some((s) => /DELETE/i.test(s)), false);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "maintenance.archived", entity: "maintenance", id: "5",
    before: { isArchived: false }, after: { isArchived: true },
  }]);
  t.mock.restoreAll();
  lockedClient(t, archivedRow, null);
  await assert.rejects(archiveMaintenance({ id: "5", ...actor }), { code: "MAINTENANCE_ALREADY_ARCHIVED", status: 409 });
});

test("due classification: boundaries around today and the 30-day window", () => {
  const today = "2026-12-15";
  const at = (next, archived) => classifyMaintenanceDue(next, today, archived);
  assert.equal(at("2026-12-14"), "overdue"); // yesterday
  assert.equal(at("2026-12-15"), "upcoming"); // due today is not overdue
  assert.equal(at("2026-12-16"), "upcoming"); // tomorrow
  assert.equal(at("2027-01-14"), "upcoming"); // exactly 30 days
  assert.equal(at("2027-01-15"), "none"); // 31 days
  assert.equal(at(null), "none");
  assert.equal(at("2026-12-14", true), "none"); // archived is never due
  assert.equal(at("2026-12-16", true), "none");
});

function usePool(t, rows = []) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => { calls.push({ sql, values }); return { rows }; });
  return calls;
}

test("upcoming and overdue queries use the business date, bound parameters and active records only", async (t) => {
  // 20:00 UTC on 15 December is already 16 December in Asia/Karachi.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-15T20:00:00Z") });
  const calls = usePool(t);
  const upcoming = await listUpcomingMaintenance({});
  assert.equal(upcoming.asOf, "2026-12-16");
  assert.equal(upcoming.upcomingThrough, "2027-01-15");
  assert.match(calls[0].sql, /m\.archived_at IS NULL/);
  assert.match(calls[0].sql, /m\.next_service_date IS NOT NULL/);
  assert.match(calls[0].sql, /m\.next_service_date >= \$1::date/);
  assert.match(calls[0].sql, /m\.next_service_date <= \$2::date/);
  assert.match(calls[0].sql, /ORDER BY m\.next_service_date ASC, m\.id ASC/);
  assert.deepEqual(calls[0].values, ["2026-12-16", "2027-01-15", 25, 0]);

  const overdue = await listOverdueMaintenance({ busId: "3" });
  assert.equal(overdue.kind, "overdue");
  assert.match(calls[1].sql, /m\.next_service_date < \$2::date/);
  assert.equal(calls[1].sql.includes("<="), false);
  assert.deepEqual(calls[1].values, ["3", "2026-12-16", 25, 0]);
});

test("bus history is newest first, includes archived by default and checks the bus exists", async (t) => {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM fleet_buses WHERE id")) return { rows: [{ id: "1", bus_number: "BUS-101", is_archived: true }] };
    return { rows: [{ ...row(), total_count: "1" }] };
  });
  const history = await getBusMaintenanceHistory("1", {});
  assert.deepEqual(history.bus, { id: "1", busNumber: "BUS-101", isArchived: true });
  assert.equal(history.total, 1);
  assert.match(calls[1].sql, /ORDER BY m\.service_date DESC, m\.id DESC/);
  assert.equal(calls[1].sql.includes("archived_at IS NULL"), false);
  assert.deepEqual(calls[1].values, ["1", 25, 0]);
  await getBusMaintenanceHistory("1", { archived: "false" });
  assert.match(calls[3].sql, /m\.archived_at IS NULL/);

  t.mock.restoreAll();
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  await assert.rejects(getBusMaintenanceHistory("9", {}), { code: "BUS_NOT_FOUND", status: 404 });
  await assert.rejects(getBusMaintenanceHistory("abc", {}), { code: "INVALID_BUS_ID", status: 400 });
});