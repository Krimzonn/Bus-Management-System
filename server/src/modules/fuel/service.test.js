import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  archiveFuelRecord, createFuelRecord, getBusFuelHistory, getFuelSummary, listFuelRecords,
  updateFuelRecord,
} from "./service.js";

// Unit tests with a fake database. Triggers, real locking and concurrency are
// covered against PostgreSQL in fuel.integration.test.js.
const actor = { actorId: "7", actorEmail: "staff@example.com" };
const input = { busId: "1", purchaseDate: "2026-11-01", liters: 40, totalCost: 60, odometer: 10500 };

function row(overrides = {}) {
  return {
    id: "5", bus_id: "1", purchase_date: "2026-11-01", liters: "40.00", total_cost: "60.00",
    odometer: 10500, created_by: "7", updated_by: "7", archived_by: null, archived_at: null,
    created_at: new Date(), updated_at: new Date(), ...overrides,
  };
}
const BUS = { id: "1", bus_number: "BUS-101", is_archived: false };

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

// previous/next simulate the neighbouring active readings of the bus.
function handlerFor({ bus = BUS, previous = null, next = null, current } = {}) {
let record = current === undefined ? row() : current;
  return (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM fleet_buses WHERE id = $1 FOR SHARE")) return { rows: [] };
    if (sql.includes("FROM fleet_buses WHERE id = ANY")) return { rows: bus ? [bus] : [] };
    if (sql.includes("previous_max")) return { rows: [{ previous_max: previous, next_min: next }] };
    if (sql.includes("INSERT INTO fuel_purchases")) return { rows: [{ id: "5" }] };
    if (sql.startsWith("UPDATE fuel_purchases")) {
      record = row({ liters: "25.00", odometer: 10700, archived_at: null });
      return { rows: [] };
    }
    if (sql.includes("FROM fuel_purchases f")) return { rows: record ? [record] : [] };
    return null;
  };
}

test("create locks the bus, validates the odometer, inserts and audits in one transaction", async (t) => {
  const client = useClient(t, handlerFor({ previous: 10000, next: 11000 }));
  const record = await createFuelRecord({ input, ...actor });
  assert.equal(record.id, "5");
  assert.equal(record.busNumber, "BUS-101");
  assert.equal(record.createdBy, "7");
  const order = sqls(client);
  assert.equal(order[0], "BEGIN");
  const insert = position(client, /INSERT INTO fuel_purchases/);
  assert.ok(position(client, /pg_advisory_xact_lock/) < insert);
  assert.ok(position(client, /FROM fleet_buses WHERE id = \$1 FOR SHARE/) < insert);
  assert.ok(position(client, /previous_max/) < insert);
  assert.ok(insert < position(client, /INSERT INTO audit_logs/));
  assert.equal(order.at(-1), "COMMIT");
  const call = client.calls[insert];
  assert.deepEqual(call.values, ["1", "2026-11-01", "40.00", "60.00", 10500, "7"]);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "fuel.created", entity: "fuel", id: "5", before: null,
    after: { busId: "1", purchaseDate: "2026-11-01", liters: "40.00", totalCost: "60.00", odometer: 10500, isArchived: false },
  }]);
});

test("a failed audit write rolls the creation back", async (t) => {
  const handler = handlerFor();
  const client = useClient(t, (sql, values) => {
    if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
    return handler(sql, values);
  });
  await assert.rejects(createFuelRecord({ input, ...actor }), /audit down/);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  assert.equal(sqls(client).includes("COMMIT"), false);
});

test("a missing or archived bus is refused before anything is written", async (t) => {
  let client = useClient(t, handlerFor({ bus: null }));
  await assert.rejects(createFuelRecord({ input, ...actor }), { code: "BUS_NOT_FOUND", status: 404 });
  assert.equal(position(client, /INSERT/), -1);
  t.mock.restoreAll();
  client = useClient(t, handlerFor({ bus: { ...BUS, is_archived: true } }));
  await assert.rejects(createFuelRecord({ input, ...actor }), { code: "BUS_ARCHIVED", status: 409 });
  assert.equal(position(client, /INSERT/), -1);
});

test("invalid input never opens a transaction", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => assert.fail("must not connect"));
  await assert.rejects(createFuelRecord({ input: { ...input, liters: 0 }, ...actor }), { code: "INVALID_LITERS" });
  await assert.rejects(createFuelRecord({ input: { ...input, odometer: -1 }, ...actor }), { code: "INVALID_ODOMETER" });
  await assert.rejects(updateFuelRecord({ id: "x", input: { liters: 1 }, ...actor }), { code: "INVALID_FUEL_ID" });
  assert.equal(connect.mock.callCount(), 0);
});

test("a reading below the previous or above the next date's reading is refused", async (t) => {
  let client = useClient(t, handlerFor({ previous: 10600 }));
  await assert.rejects(createFuelRecord({ input, ...actor }), { code: "ODOMETER_BELOW_PREVIOUS", status: 409 });
  assert.equal(position(client, /INSERT/), -1);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  t.mock.restoreAll();
  client = useClient(t, handlerFor({ next: 10400 }));
  await assert.rejects(createFuelRecord({ input, ...actor }), { code: "ODOMETER_ABOVE_NEXT", status: 409 });
  assert.equal(position(client, /INSERT/), -1);
});

test("equal readings are allowed (the odometer must not decrease, not increase)", async (t) => {
  useClient(t, handlerFor({ previous: 10500, next: 10500 }));
  assert.equal((await createFuelRecord({ input, ...actor })).id, "5");
});

test("a database sequence violation is reported as a 409", async (t) => {
  const handler = handlerFor();
  useClient(t, (sql, values) => {
    if (sql.includes("INSERT INTO fuel_purchases")) {
      throw Object.assign(new Error("x"), { code: "23514", constraint: "fuel_purchases_odometer_sequence" });
    }
    return handler(sql, values);
  });
  await assert.rejects(createFuelRecord({ input, ...actor }), { code: "ODOMETER_SEQUENCE_VIOLATION", status: 409 });
});

test("update checks the edited reading against its neighbours, excluding itself", async (t) => {
  const client = useClient(t, handlerFor({ previous: 10000, next: 11000 }));
  const updated = await updateFuelRecord({ id: "5", input: { odometer: 10700, liters: 25 }, ...actor });
  assert.equal(updated.odometer, 10700);
  const check = client.calls.find((c) => c.sql.includes("previous_max"));
  assert.deepEqual(check.values, ["1", "2026-11-01", "5"]);
  const update = client.calls.find((c) => c.sql.startsWith("UPDATE fuel_purchases"));
  const setClause = update.sql.split("WHERE")[0];
  assert.match(setClause, /liters = \$1/);
  assert.match(setClause, /odometer = \$2/);
  assert.match(setClause, /updated_by = \$3/);
  assert.doesNotMatch(setClause, /purchase_date|total_cost/);
  assert.deepEqual(update.values, ["25.00", 10700, "7", "5"]);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "fuel.updated", entity: "fuel", id: "5",
    before: { liters: "40.00", odometer: 10500 }, after: { liters: "25.00", odometer: 10700 },
  }]);
});

test("update refuses a middle reading that breaks the sequence (9500 and 11500 vs 10000..11000)", async (t) => {
  for (const [odometer, code] of [[9500, "ODOMETER_BELOW_PREVIOUS"], [11500, "ODOMETER_ABOVE_NEXT"]]) {
    const client = useClient(t, handlerFor({ previous: 10000, next: 11000 }));
    await assert.rejects(updateFuelRecord({ id: "5", input: { odometer }, ...actor }), { code, status: 409 });
    assert.equal(position(client, /^UPDATE/), -1);
    assert.equal(position(client, /INSERT INTO audit_logs/), -1);
    assert.equal(sqls(client).at(-1), "ROLLBACK");
    t.mock.restoreAll();
  }
});

test("changing only liters or cost does not re-run the odometer check; no change writes nothing", async (t) => {
  let client = useClient(t, handlerFor());
  await updateFuelRecord({ id: "5", input: { liters: 25 }, ...actor });
  assert.equal(position(client, /previous_max/), -1);
  t.mock.restoreAll();
  client = useClient(t, handlerFor());
  await updateFuelRecord({ id: "5", input: { liters: "40", odometer: 10500 }, ...actor });
  assert.equal(position(client, /^UPDATE|INSERT/), -1);
});

test("update rejects missing and archived records", async (t) => {
  useClient(t, handlerFor({ current: null }));
  await assert.rejects(updateFuelRecord({ id: "5", input: { liters: 1 }, ...actor }), { code: "FUEL_RECORD_NOT_FOUND", status: 404 });
  t.mock.restoreAll();
  useClient(t, handlerFor({ current: row({ archived_at: new Date(), archived_by: "7" }) }));
  await assert.rejects(updateFuelRecord({ id: "5", input: { liters: 1 }, ...actor }), { code: "FUEL_RECORD_ARCHIVED", status: 409 });
});

test("archive updates (never deletes) and audits; a second archive is rejected", async (t) => {
  const archivedRow = row({ archived_at: new Date(), archived_by: "7" });
  let current = row();
  const client = useClient(t, (sql) => {
    if (sql.includes("FROM fleet_buses WHERE id = ANY")) return { rows: [BUS] };
    if (sql.startsWith("UPDATE fuel_purchases")) { current = archivedRow; return { rows: [] }; }
    if (sql.includes("FROM fuel_purchases f")) return { rows: [current] };
    return null;
  });
  const archived = await archiveFuelRecord({ id: "5", ...actor });
  assert.equal(archived.isArchived, true);
  assert.equal(sqls(client).some((s) => /DELETE/i.test(s)), false);
  assert.deepEqual(audits(client), [{
    actor: "7", action: "fuel.archived", entity: "fuel", id: "5",
    before: { isArchived: false }, after: { isArchived: true },
  }]);
  await assert.rejects(archiveFuelRecord({ id: "5", ...actor }), { code: "FUEL_RECORD_ALREADY_ARCHIVED", status: 409 });
});

function usePool(t, handler) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM fleet_buses")) return { rows: [BUS] };
    return handler(sql, values) ?? { rows: [] };
  });
  return calls;
}

test("list hides archived by default, uses bound parameters and sorts by the DATE column", async (t) => {
  const calls = usePool(t, () => ({ rows: [{ ...row(), total_count: "1" }] }));
  const result = await listFuelRecords({ busId: "1", purchaseFrom: "2026-01-01", purchaseTo: "2026-12-31", page: "2", limit: "10" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].busNumber, "BUS-101");
  assert.match(calls[0].sql, /f\.archived_at IS NULL/);
  assert.match(calls[0].sql, /f\.purchase_date >= \$2::date/);
  assert.match(calls[0].sql, /f\.purchase_date <= \$3::date/);
  assert.match(calls[0].sql, /ORDER BY f\.purchase_date DESC, f\.odometer DESC, f\.id DESC/);
  assert.deepEqual(calls[0].values, ["1", "2026-01-01", "2026-12-31", 10, 10]);
});

test("bus history is oldest first, includes archived by default and checks the bus exists", async (t) => {
  const calls = usePool(t, () => ({ rows: [{ ...row(), total_count: "1" }] }));
  const history = await getBusFuelHistory("1", {});
  assert.deepEqual(history.bus, { id: "1", busNumber: "BUS-101", isArchived: false });
  const query = calls.find((c) => c.sql.includes("FROM fuel_purchases f"));
  assert.match(query.sql, /ORDER BY f\.purchase_date ASC, f\.odometer ASC, f\.id ASC/);
  assert.equal(query.sql.includes("archived_at IS NULL"), false);
  assert.deepEqual(query.values, ["1", 25, 0]);
  t.mock.restoreAll();
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  await assert.rejects(getBusFuelHistory("9", {}), { code: "BUS_NOT_FOUND", status: 404 });
  await assert.rejects(getBusFuelHistory("abc", {}), { code: "INVALID_BUS_ID", status: 400 });
});

test("summary filters inclusively, excludes archived by default and computes totals and efficiency", async (t) => {
  const calls = usePool(t, () => ({
    rows: [
      { bus_id: "1", liters: "40.00", total_cost: "60.00", odometer: 10000 },
      { bus_id: "1", liters: "50.00", total_cost: "75.50", odometer: 10500 },
      { bus_id: "2", liters: "10.10", total_cost: "20.20", odometer: 300 },
    ],
  }));
  const summary = await getFuelSummary({ startDate: "2026-11-01", endDate: "2026-11-30" });
  assert.match(calls[0].sql, /f\.archived_at IS NULL/);
  assert.match(calls[0].sql, /f\.purchase_date >= \$1::date/);
  assert.match(calls[0].sql, /f\.purchase_date <= \$2::date/);
  assert.deepEqual(calls[0].values, ["2026-11-01", "2026-11-30"]);
  assert.equal(summary.recordCount, 3);
  assert.equal(summary.totalLiters, "100.10");
  assert.equal(summary.totalCost, "155.70");
  const [one, two] = summary.buses;
  assert.equal(one.efficiency.distancePerLiter, 5.56);
  assert.equal(two.efficiency.reason, "NOT_ENOUGH_RECORDS");
  assert.equal(summary.efficiency.status, "ok");
  assert.deepEqual([summary.efficiency.busesIncluded, summary.efficiency.busesExcluded], [1, 1]);
});

test("a bus summary with archived=all drops the archive clause; empty ranges say why", async (t) => {
  const calls = usePool(t, () => ({ rows: [] }));
  const summary = await getFuelSummary({ startDate: "2026-11-01", endDate: "2026-11-30", busId: "1", archived: "all" });
  assert.equal(calls.find((c) => c.sql.includes("FROM fuel_purchases f")).sql.includes("archived_at"), false);
  assert.equal(summary.totalLiters, "0.00");
  assert.equal(summary.totalCost, "0.00");
  assert.equal(summary.efficiency.status, "insufficient_data");
  assert.equal(summary.efficiency.reason, "NO_RECORDS");
  await assert.rejects(getFuelSummary({ startDate: "2026-12-01", endDate: "2026-11-01" }), { code: "INVALID_DATE_RANGE" });
});