import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import * as service from "./service.js";

const {
  archiveRoute, createRoute, evaluateRouteEligibility, getRoute, getRouteAssignmentEligibility,
  listRoutes, listSelectableRoutes, setRouteStatus, updateRoute,
} = service;

const actor = { actorId: "7", actorEmail: "admin@example.com" };
const newRoute = { routeCode: "r-101", name: "City Centre to Airport", origin: "City Centre", destination: "Airport" };

function row(overrides = {}) {
  return {
    id: "5", route_code: "R-101", name: "City Centre to Airport", origin: "City Centre",
    destination: "Airport", status: "unblocked", is_archived: false, archived_at: null,
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
const archivedRow = () => row({ is_archived: true, archived_at: new Date() });

test("createRoute inserts the route and its audit entry in one transaction", async (t) => {
  const client = fakeClient((sql) => (sql.includes("INSERT INTO routes_routes") ? { rows: [row()] } : null));
  t.mock.method(pool, "connect", async () => client);
  const route = await createRoute({ input: newRoute, ...actor });
  assert.equal(route.routeCode, "R-101");
  assert.equal(route.status, "unblocked");
  const order = sqls(client);
  assert.equal(order[0], "BEGIN");
  assert.ok(order.findIndex((s) => s.includes("INSERT INTO routes_routes")) < order.findIndex((s) => s.includes("INSERT INTO audit_logs")));
  assert.equal(order.at(-1), "COMMIT");
  const insert = find(client, "INSERT INTO routes_routes");
  assert.deepEqual(insert.values, ["R-101", "City Centre to Airport", "City Centre", "Airport", "unblocked"]);
  const audit = find(client, "INSERT INTO audit_logs").values;
  assert.equal(audit[2], "route.created");
  assert.equal(audit[3], "route");
  assert.equal(audit[4], "5");
  assert.equal(audit[5], null);
  assert.deepEqual(JSON.parse(audit[6]), {
    routeCode: "R-101", name: "City Centre to Airport", origin: "City Centre",
    destination: "Airport", status: "unblocked", isArchived: false,
  });
});

test("createRoute maps a unique violation (including archived codes) to 409", async (t) => {
  const client = fakeClient((sql) => {
    if (sql.includes("INSERT INTO routes_routes")) throw Object.assign(new Error("dup"), { code: "23505" });
  });
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(createRoute({ input: newRoute, ...actor }), { code: "ROUTE_ALREADY_EXISTS", status: 409 });
  assert.ok(sqls(client).includes("ROLLBACK"));
  assert.equal(find(client, "INSERT INTO audit_logs"), undefined);
});

test("createRoute rejects invalid input before touching the database", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => { throw new Error("should not connect"); });
  await assert.rejects(createRoute({ input: { ...newRoute, routeCode: "" }, ...actor }), { code: "INVALID_ROUTE_CODE" });
  await assert.rejects(createRoute({ input: { ...newRoute, name: undefined }, ...actor }), { code: "INVALID_ROUTE_NAME" });
  await assert.rejects(createRoute({ input: { ...newRoute, status: "open" }, ...actor }), { code: "INVALID_ROUTE_STATUS" });
  await assert.rejects(createRoute({ input: { ...newRoute, extra: 1 }, ...actor }), { code: "INVALID_INPUT" });
  assert.equal(connect.mock.callCount(), 0);
});

test("updateRoute changes only modified fields and audits before/after", async (t) => {
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [row()] };
    if (sql.includes("UPDATE routes_routes")) return { rows: [row({ destination: "Terminal 2" })] };
  });
  t.mock.method(pool, "connect", async () => client);
  const route = await updateRoute({ id: "5", input: { destination: "Terminal 2", name: "City Centre to Airport" }, ...actor });
  assert.equal(route.destination, "Terminal 2");
  const update = find(client, "UPDATE routes_routes");
  const setClause = update.sql.split("WHERE")[0];
  assert.match(setClause, /destination = \$1/);
  assert.doesNotMatch(setClause, /name =/);
  const audit = find(client, "INSERT INTO audit_logs").values;
  assert.equal(audit[2], "route.updated");
  assert.deepEqual(JSON.parse(audit[5]), { destination: "Airport" });
  assert.deepEqual(JSON.parse(audit[6]), { destination: "Terminal 2" });
});

test("updateRoute does nothing (no audit) when values are unchanged", async (t) => {
  const client = fakeClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [row()] } : null));
  t.mock.method(pool, "connect", async () => client);
  await updateRoute({ id: "5", input: { name: "City Centre to Airport", routeCode: "r-101" }, ...actor });
  assert.equal(find(client, "UPDATE routes_routes"), undefined);
  assert.equal(find(client, "INSERT INTO audit_logs"), undefined);
});

test("updateRoute rejects archived routes, changed codes, invalid fields and missing routes", async (t) => {
  let current = archivedRow();
  const client = fakeClient((sql) => (sql.includes("FOR UPDATE") ? { rows: current ? [current] : [] } : null));
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(updateRoute({ id: "5", input: { name: "X" }, ...actor }), { code: "ROUTE_ARCHIVED", status: 409 });
  current = row();
  await assert.rejects(updateRoute({ id: "5", input: { routeCode: "OTHER-1" }, ...actor }), { code: "ROUTE_CODE_IMMUTABLE" });
  await assert.rejects(updateRoute({ id: "5", input: { name: "" }, ...actor }), { code: "INVALID_ROUTE_NAME" });
  await assert.rejects(updateRoute({ id: "5", input: { status: "blocked" }, ...actor }), { code: "INVALID_INPUT" });
  current = null;
  await assert.rejects(updateRoute({ id: "5", input: { name: "X" }, ...actor }), { code: "ROUTE_NOT_FOUND", status: 404 });
});

test("setRouteStatus blocks and unblocks with audit entries", async (t) => {
  let current = row();
  let next = row({ status: "blocked" });
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [current] };
    if (sql.includes("UPDATE routes_routes")) return { rows: [next] };
  });
  t.mock.method(pool, "connect", async () => client);
  const blocked = await setRouteStatus({ id: "5", input: { status: "blocked" }, ...actor });
  assert.equal(blocked.status, "blocked");
  let audit = find(client, "INSERT INTO audit_logs").values;
  assert.equal(audit[2], "route.status_changed");
  assert.deepEqual(JSON.parse(audit[5]), { status: "unblocked" });
  assert.deepEqual(JSON.parse(audit[6]), { status: "blocked" });

  current = row({ status: "blocked" });
  next = row({ status: "unblocked" });
  const reopened = await setRouteStatus({ id: "5", input: { status: "unblocked" }, ...actor });
  assert.equal(reopened.status, "unblocked");
});

test("setRouteStatus is a no-op for the same status and rejects bad or archived input", async (t) => {
  let current = row();
  const client = fakeClient((sql) => (sql.includes("FOR UPDATE") ? { rows: [current] } : null));
  t.mock.method(pool, "connect", async () => client);
  await setRouteStatus({ id: "5", input: { status: "unblocked" }, ...actor });
  assert.equal(find(client, "UPDATE routes_routes"), undefined);
  assert.equal(find(client, "INSERT INTO audit_logs"), undefined);
  await assert.rejects(setRouteStatus({ id: "5", input: { status: "Blocked" }, ...actor }), { code: "INVALID_ROUTE_STATUS" });
  current = archivedRow();
  await assert.rejects(setRouteStatus({ id: "5", input: { status: "blocked" }, ...actor }), { code: "ROUTE_ARCHIVED" });
});

test("archiveRoute archives (never deletes) with an audit entry; a second archive is rejected", async (t) => {
  let current = row();
  const client = fakeClient((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [current] };
    if (sql.includes("UPDATE routes_routes")) return { rows: [archivedRow()] };
  });
  t.mock.method(pool, "connect", async () => client);
  const route = await archiveRoute({ id: "5", ...actor });
  assert.equal(route.isArchived, true);
  assert.ok(route.archivedAt);
  assert.ok(client.calls.every((c) => !/\bDELETE\b/i.test(c.sql)));
  assert.equal(typeof service.deleteRoute, "undefined");
  const audit = find(client, "INSERT INTO audit_logs").values;
  assert.equal(audit[2], "route.archived");
  assert.deepEqual(JSON.parse(audit[6]), { isArchived: true });
  current = archivedRow();
  await assert.rejects(archiveRoute({ id: "5", ...actor }), { code: "ROUTE_ALREADY_ARCHIVED", status: 409 });
});

const mutations = {
  create: () => createRoute({ input: newRoute, ...actor }),
  update: () => updateRoute({ id: "5", input: { name: "Renamed" }, ...actor }),
  status: () => setRouteStatus({ id: "5", input: { status: "blocked" }, ...actor }),
  archive: () => archiveRoute({ id: "5", ...actor }),
};

for (const [name, run] of Object.entries(mutations)) {
  test(`${name}: audit failure rolls back the route mutation`, async (t) => {
    const client = fakeClient((sql) => {
      if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
      if (sql.includes("FOR UPDATE")) return { rows: [row()] };
      if (sql.includes("INSERT INTO routes_routes")) return { rows: [row()] };
      if (sql.includes("UPDATE routes_routes")) return { rows: [row({ name: "Renamed", status: "blocked", is_archived: true, archived_at: new Date() })] };
    });
    t.mock.method(pool, "connect", async () => client);
    await assert.rejects(run(), /audit down/);
    const order = sqls(client);
    assert.ok(order.includes("ROLLBACK"));
    assert.ok(!order.includes("COMMIT"));
  });
}

test("getRoute returns 404 for unknown ids and 400 for malformed ids", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  await assert.rejects(getRoute("99"), { code: "ROUTE_NOT_FOUND", status: 404 });
  await assert.rejects(getRoute("abc"), { code: "INVALID_ROUTE_ID", status: 400 });
});

test("listRoutes uses bound parameters, hides archived by default and escapes search", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => { args = a; return { rows: [{ ...row(), total_count: "31" }] }; });
  const result = await listRoutes({ q: "50%_", status: "blocked", page: "2", limit: "10" });
  assert.equal(result.total, 31);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 10);
  assert.match(args[0], /is_archived = \$1/);
  assert.match(args[0], /status = \$2/);
  assert.match(args[0], /route_code ILIKE \$3/);
  assert.match(args[0], /ORDER BY route_code ASC, id ASC/);
  assert.match(args[0], /LIMIT \$4 OFFSET \$5/);
  assert.deepEqual(args[1], [false, "blocked", "%50\\%\\_%", 10, 10]);
});

test("listRoutes with archived=all adds no archive clause; invalid filters are rejected", async (t) => {
  let sql;
  t.mock.method(pool, "query", async (text) => { sql = text; return { rows: [] }; });
  const result = await listRoutes({ archived: "all" });
  assert.doesNotMatch(sql, /is_archived =/);
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
  await assert.rejects(listRoutes({ status: "nope" }), { code: "INVALID_ROUTE_FILTER" });
  await assert.rejects(listRoutes({ page: "0" }), { code: "INVALID_PAGINATION" });
});

test("listSelectableRoutes returns only unblocked, non-archived routes", async (t) => {
  let args;
  t.mock.method(pool, "query", async (...a) => { args = a; return { rows: [] }; });
  await listSelectableRoutes({});
  assert.match(args[0], /is_archived = \$1/);
  assert.match(args[0], /status = \$2/);
  assert.deepEqual(args[1].slice(0, 2), [false, "unblocked"]);
  await assert.rejects(listSelectableRoutes({ status: "blocked" }), { code: "INVALID_ROUTE_FILTER" });
  await assert.rejects(listSelectableRoutes({ archived: "all" }), { code: "INVALID_ROUTE_FILTER" });
});

test("eligibility: only unblocked, non-archived routes can be assigned (BR-03)", () => {
  const route = (o) => ({ isArchived: false, status: "unblocked", ...o });
  assert.deepEqual(evaluateRouteEligibility(route()), { eligible: true, reason: null });
  assert.deepEqual(evaluateRouteEligibility(route({ status: "blocked" })), { eligible: false, reason: "ROUTE_BLOCKED" });
  assert.deepEqual(evaluateRouteEligibility(route({ isArchived: true })), { eligible: false, reason: "ROUTE_ARCHIVED" });
  assert.deepEqual(evaluateRouteEligibility(route({ status: "blocked", isArchived: true })), { eligible: false, reason: "ROUTE_ARCHIVED" });
  assert.deepEqual(evaluateRouteEligibility(route({ status: "weird" })), { eligible: false, reason: "ROUTE_UNAVAILABLE" });
  assert.deepEqual(evaluateRouteEligibility(null), { eligible: false, reason: "ROUTE_NOT_FOUND" });
});

test("getRouteAssignmentEligibility reads the route and accepts an injected executor", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [row({ status: "blocked" })] }));
  assert.equal((await getRouteAssignmentEligibility("5")).reason, "ROUTE_BLOCKED");
  const executor = { query: async () => ({ rows: [row()] }) };
  assert.equal((await getRouteAssignmentEligibility("5", executor)).eligible, true);
  const missing = { query: async () => ({ rows: [] }) };
  assert.equal((await getRouteAssignmentEligibility("5", missing)).reason, "ROUTE_NOT_FOUND");
  await assert.rejects(getRouteAssignmentEligibility("abc"), { code: "INVALID_ROUTE_ID" });
});