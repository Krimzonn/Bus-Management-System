import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  archiveBus, createBus, evaluateBusEligibility, getBus, listBuses, setBusStatus, updateBus,
} from "./service.js";

const actor = { actorId: "7", actorEmail: "admin@example.com" };

function row(overrides = {}) {
  return {
    id: "5", bus_number: "BUS-101", seating_capacity: 40, status: "active",
    required_license_category: "HTV", is_archived: false, archived_at: null,
    created_at: new Date(), updated_at: new Date(), ...overrides,
  };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      return handler(sql, values) ?? { rows: [] };
    },
    release() {},
  };
}

const sqls = (client) => client.calls.map((c) => c.sql);
const find = (client, text) => client.calls.find((c) => c.sql.includes(text));

test("createBus inserts the bus and its audit entry in one transaction", async (t) => {
  const client = fakeClient((sql) => (sql.includes("INSERT INTO fleet_buses") ? { rows: [row()] } : null));
  t.mock.method(pool, "connect", async () => client);
  const bus = await createBus({
    input: { busNumber: "bus-101", seatingCapacity: 40, requiredLicenseCategory: "htv" }, ...actor,
  });
  assert.equal(bus.busNumber, "BUS-101");
  const order = sqls(client);
  assert.equal(order[0], "BEGIN");
  assert.ok(order.findIndex((s) => s.includes("INSERT INTO fleet_buses")) < order.findIndex((s) => s.includes("INSERT INTO audit_logs")));
  assert.equal(order.at(-1), "COMMIT");
  assert.equal(find(client, "INSERT INTO audit_logs").values[2], "bus.created");
});

test("createBus maps a unique violation (including archived numbers) to 409", async (t) => {
  const client = fakeClient((sql) => {
    if (sql.includes("INSERT INTO fleet_buses")) throw Object.assign(new Error("dup"), { code: "23505" });
  });
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(
    createBus({ input: { busNumber: "BUS-101", seatingCapacity: 40, requiredLicenseCategory: "HTV" }, ...actor }),
    { code: "BUS_ALREADY_EXISTS", status: 409 },
  );
  assert.ok(sqls(client).includes("ROLLBACK"));
  assert.equal(find(client, "INSERT INTO audit_logs"), undefined);
});

test("createBus rejects invalid input before touching the database", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => { throw new Error("should not connect"); });
  await assert.rejects(createBus({ input: { busNumber: "B1", seatingCapacity: 0, requiredLicenseCategory: "HTV" }, ...actor }), { code: "INVALID_SEATING_CAPACITY" });
  assert.equal(connect.mock.callCount(), 0);
});

test("updateBus updates changed fields only and audits before/after", async (t) => {
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [row()] };
    if (sql.includes("UPDATE fleet_buses")) return { rows: [row({ seating_capacity: 50 })] };
  });
  t.mock.method(pool, "connect", async () => client);
  const bus = await updateBus({ id: "5", input: { seatingCapacity: 50, requiredLicenseCategory: "HTV" }, ...actor });
  assert.equal(bus.seatingCapacity, 50);
  const update = find(client, "UPDATE fleet_buses");
 assert.match(update.sql, /seating_capacity = \$1/);
const setClause = update.sql.split("WHERE")[0];
assert.doesNotMatch(setClause, /required_license_category/);
  assert.deepEqual(JSON.parse(find(client, "INSERT INTO audit_logs").values[5]), { seatingCapacity: 40 });
  assert.deepEqual(JSON.parse(find(client, "INSERT INTO audit_logs").values[6]), { seatingCapacity: 50 });
});

test("updateBus does nothing (no audit) when values are unchanged", async (t) => {
  const client = fakeClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [row()] } : null));
  t.mock.method(pool, "connect", async () => client);
  await updateBus({ id: "5", input: { seatingCapacity: 40 }, ...actor });
  assert.equal(find(client, "UPDATE fleet_buses"), undefined);
  assert.equal(find(client, "INSERT INTO audit_logs"), undefined);
});

test("updateBus rejects archived buses, changed bus numbers and missing buses", async (t) => {
  let current = row({ is_archived: true, archived_at: new Date() });
  const client = fakeClient((sql) => (sql.includes("FOR UPDATE") ? { rows: current ? [current] : [] } : null));
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(updateBus({ id: "5", input: { seatingCapacity: 30 }, ...actor }), { code: "BUS_ARCHIVED", status: 409 });
  current = row();
  await assert.rejects(updateBus({ id: "5", input: { busNumber: "OTHER-1" }, ...actor }), { code: "BUS_NUMBER_IMMUTABLE" });
  current = null;
  await assert.rejects(updateBus({ id: "5", input: { seatingCapacity: 30 }, ...actor }), { code: "BUS_NOT_FOUND", status: 404 });
});

test("setBusStatus changes status with an audit entry and rejects archived buses", async (t) => {
  let current = row();
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [current] };
    if (sql.includes("UPDATE fleet_buses")) return { rows: [row({ status: "under_maintenance" })] };
  });
  t.mock.method(pool, "connect", async () => client);
  const bus = await setBusStatus({ id: "5", input: { status: "under_maintenance" }, ...actor });
  assert.equal(bus.status, "under_maintenance");
  assert.equal(find(client, "INSERT INTO audit_logs").values[2], "bus.status_changed");
  await assert.rejects(setBusStatus({ id: "5", input: { status: "bogus" }, ...actor }), { code: "INVALID_BUS_STATUS" });
  current = row({ is_archived: true, archived_at: new Date() });
  await assert.rejects(setBusStatus({ id: "5", input: { status: "inactive" }, ...actor }), { code: "BUS_ARCHIVED" });
});

test("archiveBus archives once and audits; a second archive is rejected", async (t) => {
  let current = row();
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [current] };
    if (sql.includes("UPDATE fleet_buses")) return { rows: [row({ is_archived: true, archived_at: new Date() })] };
  });
  t.mock.method(pool, "connect", async () => client);
  const bus = await archiveBus({ id: "5", ...actor });
  assert.equal(bus.isArchived, true);
  assert.equal(find(client, "INSERT INTO audit_logs").values[2], "bus.archived");
  current = row({ is_archived: true, archived_at: new Date() });
  await assert.rejects(archiveBus({ id: "5", ...actor }), { code: "BUS_ALREADY_ARCHIVED", status: 409 });
});

test("listBuses uses bound parameters, hides archived by default and escapes search", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => { args = a; return { rows: [{ ...row(), total_count: "1" }] }; });
  const result = await listBuses({ q: "50%_", status: "active", requiredLicenseCategory: "htv", page: "2", limit: "10" });
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
  assert.match(args[0], /is_archived = \$1/);
  assert.match(args[0], /bus_number LIKE \$4 ESCAPE/);
  assert.match(args[0], /ORDER BY bus_number ASC, id ASC/);
  assert.match(args[0], /LIMIT \$5 OFFSET \$6/);
  assert.deepEqual(args[1], [false, "active", "HTV", "%50\\%\\_%", 10, 10]);
});

test("listBuses with archived=all adds no archive clause; invalid filters are rejected", async (t) => {
  let sql;
  t.mock.method(pool, "query", async (text) => { sql = text; return { rows: [] }; });
  const result = await listBuses({ archived: "all" });
  assert.doesNotMatch(sql, /is_archived =/);
  assert.equal(result.total, 0);
  await assert.rejects(listBuses({ status: "nope" }), { code: "INVALID_BUS_FILTER" });
});

test("getBus returns 404 for unknown ids and 400 for malformed ids", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  await assert.rejects(getBus("99"), { code: "BUS_NOT_FOUND", status: 404 });
  await assert.rejects(getBus("abc"), { code: "INVALID_BUS_ID", status: 400 });
});

test("eligibility: only active, non-archived buses can be assigned (BR-01)", () => {
  const bus = (o) => ({ isArchived: false, status: "active", requiredLicenseCategory: "HTV", ...o });
  assert.deepEqual(evaluateBusEligibility(bus()), { eligible: true, reason: null, requiredLicenseCategory: "HTV" });
  assert.equal(evaluateBusEligibility(bus({ status: "inactive" })).reason, "BUS_INACTIVE");
  assert.equal(evaluateBusEligibility(bus({ status: "under_maintenance" })).reason, "BUS_UNDER_MAINTENANCE");
  assert.equal(evaluateBusEligibility(bus({ isArchived: true })).reason, "BUS_ARCHIVED");
  assert.equal(evaluateBusEligibility(null).reason, "BUS_NOT_FOUND");
});
