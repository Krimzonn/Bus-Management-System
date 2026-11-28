import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import { createFuelRecord } from "./service.js";

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

test("fuel records against PostgreSQL", { skip: !email || !password }, async (t) => {
  const server = app.listen(0);
  const created = { accounts: [], buses: [] };
  let admin;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    admin = await openSession(base, email, password);
    const stamp = Date.now();
    let sequence = 0;
    const today = businessToday();
    const day = (offset) => addDays(today, -400 + offset); // a quiet stretch in the past

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
      const userEmail = `it-fuel-${role ?? "none"}-${stamp}-${sequence += 1}@example.com`;
      const { id } = await ok(admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD }), 201);
      created.accounts.push(id);
      if (role) await ok(admin("PUT", `/accounts/${id}/role`, { role }));
      return { id, call: await openSession(base, userEmail, TEMP_PASSWORD) };
    }
    const staff = await account("administrative_staff");
    const manager = await account("transportation_manager");

    async function newBus() {
      const bus = await ok(admin("POST", "/buses", {
        busNumber: `FU${stamp}-${sequence += 1}`, seatingCapacity: 40, requiredLicenseCategory: "HTV",
      }), 201);
      created.buses.push(bus.id);
      return bus;
    }
    const payload = (busId, overrides = {}) => ({
      busId, purchaseDate: day(0), liters: 40, totalCost: 60.5, odometer: 10000, ...overrides,
    });
    const add = (busId, overrides, session = staff.call) => session("POST", "/fuel", payload(busId, overrides));
    const added = (busId, overrides, session = staff.call) => ok(add(busId, overrides, session), 201);
    const countFor = async (busId) => Number((await pool.query(
      "SELECT COUNT(*) FROM fuel_purchases WHERE bus_id = $1", [busId],
    )).rows[0].count);
    const auditFor = async (id) =>
      (await ok(admin("GET", `/audit?entityType=fuel&entityId=${id}&limit=100`))).items;
    const ids = (page) => page.items.map((item) => item.id);
    const summary = (busId, from, to, extra = "") =>
      ok(staff.call("GET", `/fuel/summary?busId=${busId}&startDate=${from}&endDate=${to}${extra}`));

    await t.test("create, view, list, update and archive", async () => {
      const bus = await newBus();
      const record = await added(bus.id);
      assert.equal(record.busId, bus.id);
      assert.equal(record.busNumber, bus.busNumber);
      assert.equal(record.liters, "40.00");
      assert.equal(record.totalCost, "60.50");
      assert.equal(record.odometer, 10000);
      assert.equal(record.createdBy, staff.id);
      assert.equal(record.isArchived, false);
      assert.equal(record.archivedAt, null);
      assert.deepEqual(await ok(manager.call("GET", `/fuel/${record.id}`)), record);
      assert.deepEqual(ids(await ok(staff.call("GET", `/fuel?busId=${bus.id}`))), [record.id]);
      assert.deepEqual(ids(await ok(staff.call("GET", `/fuel?busId=${bus.id}&purchaseFrom=${day(0)}&purchaseTo=${day(0)}`))), [record.id]);
      assert.deepEqual(ids(await ok(staff.call("GET", `/fuel?busId=${bus.id}&purchaseFrom=${day(1)}`))), []);

      const updated = await ok(manager.call("PUT", `/fuel/${record.id}`, { liters: "45.5", totalCost: 0 }));
      assert.equal(updated.liters, "45.50");
      assert.equal(updated.totalCost, "0.00");
      assert.equal(updated.updatedBy, manager.id);
      assert.equal(updated.createdBy, staff.id);

      const archived = await ok(admin("POST", `/fuel/${record.id}/archive`));
      assert.equal(archived.isArchived, true);
      assert.ok(archived.archivedAt);
      await failsWith(admin("POST", `/fuel/${record.id}/archive`), 409, "FUEL_RECORD_ALREADY_ARCHIVED");
      await failsWith(manager.call("PUT", `/fuel/${record.id}`, { liters: 1 }), 409, "FUEL_RECORD_ARCHIVED");
      // The row is kept: still readable, hidden from the ordinary list only.
      assert.equal((await ok(admin("GET", `/fuel/${record.id}`))).isArchived, true);
      assert.deepEqual(ids(await ok(admin("GET", `/fuel?busId=${bus.id}`))), []);
      assert.deepEqual(ids(await ok(admin("GET", `/fuel?busId=${bus.id}&archived=true`))), [record.id]);
      assert.deepEqual(ids(await ok(admin("GET", `/fuel?busId=${bus.id}&archived=all`))), [record.id]);
      assert.equal(await countFor(bus.id), 1);
      assert.equal((await manager.call("DELETE", `/fuel/${record.id}`)).status, 404);
    });

    await t.test("invalid requests", async () => {
      const bus = await newBus();
      for (const [overrides, status, code] of [
        [{ busId: "abc" }, 400, "INVALID_BUS_ID"],
        [{ busId: "999999999" }, 404, "BUS_NOT_FOUND"],
        [{ purchaseDate: "2027-02-30" }, 400, "INVALID_PURCHASE_DATE"],
        [{ purchaseDate: undefined }, 400, "INVALID_PURCHASE_DATE"],
        [{ liters: undefined }, 400, "INVALID_LITERS"],
        [{ liters: 0 }, 400, "INVALID_LITERS"],
        [{ liters: -5 }, 400, "INVALID_LITERS"],
        [{ liters: "1.234" }, 400, "INVALID_LITERS"],
        [{ liters: "100000000" }, 400, "INVALID_LITERS"],
        [{ totalCost: -1 }, 400, "INVALID_TOTAL_COST"],
        [{ totalCost: "1.234" }, 400, "INVALID_TOTAL_COST"],
        [{ totalCost: "10000000000" }, 400, "INVALID_TOTAL_COST"],
        [{ odometer: -1 }, 400, "INVALID_ODOMETER"],
        [{ odometer: 10000000 }, 400, "INVALID_ODOMETER"],
        [{ odometer: 1.5 }, 400, "INVALID_ODOMETER"],
        [{ isArchived: true }, 400, "INVALID_INPUT"],
      ]) await failsWith(add(bus.id, overrides), status, code);
      assert.equal(await countFor(bus.id), 0);
      // Boundaries that are valid.
      const edge = await added(bus.id, { liters: "99999999.99", totalCost: "9999999999.99", odometer: 9999999 });
      assert.equal(edge.liters, "99999999.99");
      await failsWith(staff.call("PUT", `/fuel/${edge.id}`, {}), 400, "INVALID_INPUT");
      await failsWith(staff.call("PUT", `/fuel/${edge.id}`, { busId: bus.id }), 400, "INVALID_INPUT");
      await failsWith(staff.call("PUT", "/fuel/999999999", { liters: 1 }), 404, "FUEL_RECORD_NOT_FOUND");
      await failsWith(staff.call("GET", "/fuel/999999999"), 404, "FUEL_RECORD_NOT_FOUND");
      await failsWith(staff.call("GET", "/fuel/abc"), 400, "INVALID_FUEL_ID");
      await failsWith(staff.call("GET", "/fuel?archived=maybe"), 400, "INVALID_FUEL_FILTER");
      await failsWith(staff.call("GET", "/fuel?page=0"), 400, "INVALID_PAGINATION");
      await failsWith(staff.call("GET", "/fuel/bus/abc"), 400, "INVALID_BUS_ID");
      await failsWith(staff.call("GET", "/fuel/bus/999999999"), 404, "BUS_NOT_FOUND");
    });

    await t.test("odometer: create, insert between and edit against both neighbours", async () => {
      const bus = await newBus();
      const first = await added(bus.id, { purchaseDate: day(0), odometer: 10000 });
      const last = await added(bus.id, { purchaseDate: day(10), odometer: 11000 });
      // Insert between existing readings.
      const middle = await added(bus.id, { purchaseDate: day(5), odometer: 10500 });
      await failsWith(add(bus.id, { purchaseDate: day(6), odometer: 9999 }), 409, "ODOMETER_BELOW_PREVIOUS");
      await failsWith(add(bus.id, { purchaseDate: day(4), odometer: 10600 }), 409, "ODOMETER_ABOVE_NEXT");
      await failsWith(add(bus.id, { purchaseDate: day(-1), odometer: 10001 }), 409, "ODOMETER_ABOVE_NEXT");
      await failsWith(add(bus.id, { purchaseDate: day(11), odometer: 10999 }), 409, "ODOMETER_BELOW_PREVIOUS");
      assert.equal(await countFor(bus.id), 3);

      // Middle: lower than the previous, higher than the next, and valid.
      await failsWith(staff.call("PUT", `/fuel/${middle.id}`, { odometer: 9500 }), 409, "ODOMETER_BELOW_PREVIOUS");
      await failsWith(staff.call("PUT", `/fuel/${middle.id}`, { odometer: 11500 }), 409, "ODOMETER_ABOVE_NEXT");
      assert.equal((await ok(staff.call("PUT", `/fuel/${middle.id}`, { odometer: 10700 }))).odometer, 10700);
      // Moving the date re-validates too: 10700 cannot sit after the 11000 reading's date... it can only
      // move within [10000 .. 11000] dates.
      await failsWith(staff.call("PUT", `/fuel/${middle.id}`, { purchaseDate: day(11) }), 409, "ODOMETER_BELOW_PREVIOUS");
      await failsWith(staff.call("PUT", `/fuel/${middle.id}`, { purchaseDate: day(-1) }), 409, "ODOMETER_ABOVE_NEXT");
      // Earliest and latest.
      await failsWith(staff.call("PUT", `/fuel/${first.id}`, { odometer: 10800 }), 409, "ODOMETER_ABOVE_NEXT");
      assert.equal((await ok(staff.call("PUT", `/fuel/${first.id}`, { odometer: 10700 }))).odometer, 10700); // equal is allowed
      await failsWith(staff.call("PUT", `/fuel/${last.id}`, { odometer: 10699 }), 409, "ODOMETER_BELOW_PREVIOUS");
      assert.equal((await ok(staff.call("PUT", `/fuel/${last.id}`, { odometer: 99999 }))).odometer, 99999);
      // Other fields never depend on the sequence.
      await ok(staff.call("PUT", `/fuel/${last.id}`, { liters: 12 }));
    });

    await t.test("same-date readings are not ordered against each other", async () => {
      const bus = await newBus();
      await added(bus.id, { purchaseDate: day(0), odometer: 20000 });
      const noon = await added(bus.id, { purchaseDate: day(5), odometer: 20500 });
      const earlier = await added(bus.id, { purchaseDate: day(5), odometer: 20100 }); // entered later, lower: allowed
      await added(bus.id, { purchaseDate: day(5), odometer: 20500 });
      await failsWith(add(bus.id, { purchaseDate: day(5), odometer: 19999 }), 409, "ODOMETER_BELOW_PREVIOUS");
      const history = await ok(staff.call("GET", `/fuel/bus/${bus.id}`));
      const sameDay = history.items.filter((item) => item.purchaseDate === day(5)).map((item) => item.odometer);
      assert.deepEqual(sameDay, [20100, 20500, 20500]); // deterministic: odometer, then id
      assert.ok(ids(history).includes(noon.id) && ids(history).includes(earlier.id));
    });

    await t.test("archived records leave the active sequence but stay in history", async () => {
      const bus = await newBus();
      await added(bus.id, { purchaseDate: day(0), odometer: 30000 });
      const wrong = await added(bus.id, { purchaseDate: day(5), odometer: 39000 }); // a typo
      await failsWith(add(bus.id, { purchaseDate: day(10), odometer: 30500 }), 409, "ODOMETER_BELOW_PREVIOUS");
      await ok(admin("POST", `/fuel/${wrong.id}/archive`));
      await added(bus.id, { purchaseDate: day(10), odometer: 30500 });
      const all = await ok(staff.call("GET", `/fuel/bus/${bus.id}`));
      assert.equal(all.total, 3);
      assert.equal(all.items.find((item) => item.id === wrong.id).isArchived, true);
      assert.equal((await ok(staff.call("GET", `/fuel/bus/${bus.id}?archived=false`))).total, 2);
    });

    await t.test("bus history is chronological and survives an archived bus", async () => {
      const bus = await newBus();
      const c = await added(bus.id, { purchaseDate: day(20), odometer: 40300 });
      const a = await added(bus.id, { purchaseDate: day(0), odometer: 40000 });
      const b = await added(bus.id, { purchaseDate: day(10), odometer: 40200 });
      await ok(admin("POST", `/fuel/${b.id}/archive`));
      let history = await ok(staff.call("GET", `/fuel/bus/${bus.id}`));
      assert.deepEqual(ids(history), [a.id, b.id, c.id]);
      assert.deepEqual(history.bus, { id: bus.id, busNumber: bus.busNumber, isArchived: false });
      assert.deepEqual(ids(await ok(staff.call("GET", `/fuel/bus/${bus.id}?purchaseFrom=${day(10)}&purchaseTo=${day(20)}`))), [b.id, c.id]);

      await ok(admin("POST", `/buses/${bus.id}/archive`));
      history = await ok(staff.call("GET", `/fuel/bus/${bus.id}`));
      assert.equal(history.bus.isArchived, true);
      assert.equal(history.total, 3);
      assert.equal(history.items[0].isBusArchived, true);
      assert.equal((await ok(staff.call("GET", `/fuel/${a.id}`))).busNumber, bus.busNumber);
      assert.ok(ids(await ok(staff.call("GET", `/fuel?busId=${bus.id}`))).includes(a.id));
      // No new records for an archived bus, but existing ones can still be corrected.
      await failsWith(add(bus.id, { purchaseDate: day(30), odometer: 41000 }), 409, "BUS_ARCHIVED");
      await ok(staff.call("PUT", `/fuel/${a.id}`, { totalCost: 99 }));
      assert.equal(await countFor(bus.id), 3);
    });

    await t.test("summary: inclusive dates, totals, efficiency and the archived policy", async () => {
      const bus = await newBus();
      const s = 100;
      const r1 = await added(bus.id, { purchaseDate: day(s), odometer: 10000, liters: "40.00", totalCost: "100.00" });
      const r2 = await added(bus.id, { purchaseDate: day(s + 5), odometer: 10400, liters: "30.00", totalCost: "80.50" });
      await added(bus.id, { purchaseDate: day(s + 10), odometer: 10900, liters: "50.00", totalCost: "120.25" });
      await added(bus.id, { purchaseDate: day(s + 11), odometer: 11000, liters: "9.00", totalCost: "9.00" }); // outside
      await added(bus.id, { purchaseDate: day(s - 1), odometer: 9900, liters: "9.00", totalCost: "9.00" }); // outside

      let result = await summary(bus.id, day(s), day(s + 10)); // both ends inclusive
      assert.equal(result.recordCount, 3);
      assert.equal(result.totalLiters, "120.00");
      assert.equal(result.totalCost, "300.75");
      assert.deepEqual([result.efficiency.status, result.efficiency.distance, result.efficiency.distancePerLiter], ["ok", 900, 7.5]);
      assert.equal(result.busId, bus.id);

      result = await summary(bus.id, day(s), day(s + 5));
      assert.deepEqual([result.totalLiters, result.totalCost, result.efficiency.distancePerLiter], ["70.00", "180.50", 5.71]);
      result = await summary(bus.id, day(s + 1), day(s + 9)); // only the middle record
      assert.equal(result.recordCount, 1);
      assert.deepEqual([result.efficiency.status, result.efficiency.label, result.efficiency.reason],
        ["insufficient_data", "Insufficient data", "NOT_ENOUGH_RECORDS"]);
      assert.equal(result.efficiency.distancePerLiter, null);
      result = await summary(bus.id, day(s + 20), day(s + 30));
      assert.deepEqual([result.recordCount, result.totalLiters, result.efficiency.reason], [0, "0.00", "NO_RECORDS"]);
      result = await summary(bus.id, day(s + 5), day(s + 5)); // a one-day range
      assert.equal(result.recordCount, 1);

      // Archived records are excluded unless requested explicitly.
      await ok(admin("POST", `/fuel/${r2.id}/archive`));
      result = await summary(bus.id, day(s), day(s + 10));
      assert.deepEqual([result.recordCount, result.totalLiters, result.efficiency.distancePerLiter], [2, "90.00", 10]);
      result = await summary(bus.id, day(s), day(s + 10), "&archived=all");
      assert.deepEqual([result.recordCount, result.totalLiters, result.efficiency.distancePerLiter], [3, "120.00", 7.5]);
      assert.equal(r1.busId, bus.id);
    });

    await t.test("summary: zero distance, several buses and invalid ranges", async () => {
      const flat = await newBus();
      await added(flat.id, { purchaseDate: day(200), odometer: 5000 });
      await added(flat.id, { purchaseDate: day(201), odometer: 5000 });
      const zero = await summary(flat.id, day(200), day(201));
      assert.equal(zero.efficiency.reason, "ZERO_DISTANCE");
      assert.equal(zero.efficiency.distancePerLiter, null);

      const good = await newBus();
      await added(good.id, { purchaseDate: day(200), odometer: 100, liters: "10.00", totalCost: "10.00" });
      await added(good.id, { purchaseDate: day(201), odometer: 200, liters: "10.00", totalCost: "10.00" });
      const lonely = await newBus();
      await added(lonely.id, { purchaseDate: day(200), odometer: 7, liters: "5.00", totalCost: "5.00" });
      const all = await ok(staff.call("GET", `/fuel/summary?startDate=${day(200)}&endDate=${day(201)}`));
      const mine = all.buses.filter((bus) => [flat.id, good.id, lonely.id].includes(bus.busId));
      assert.equal(mine.length, 3);
      assert.equal(mine.find((bus) => bus.busId === good.id).efficiency.distancePerLiter, 5);
      assert.equal(mine.find((bus) => bus.busId === lonely.id).efficiency.reason, "NOT_ENOUGH_RECORDS");

      await failsWith(staff.call("GET", `/fuel/summary?startDate=${day(5)}&endDate=${day(4)}`), 400, "INVALID_DATE_RANGE");
      await failsWith(staff.call("GET", `/fuel/summary?startDate=${day(5)}`), 400, "INVALID_FUEL_FILTER");
      await failsWith(staff.call("GET", "/fuel/summary?startDate=x&endDate=y"), 400, "INVALID_FUEL_FILTER");
      await failsWith(staff.call("GET", `/fuel/summary?startDate=${day(1)}&endDate=${day(2)}&busId=999999999`), 404, "BUS_NOT_FOUND");
    });

    await t.test("every successful mutation is audited with actor and before/after values", async () => {
      const bus = await newBus();
      const record = await added(bus.id);
      await ok(manager.call("PUT", `/fuel/${record.id}`, { liters: 41 }));
      await failsWith(manager.call("PUT", `/fuel/${record.id}`, { odometer: -1 }), 400, "INVALID_ODOMETER");
      await ok(admin("POST", `/fuel/${record.id}/archive`));
      await failsWith(manager.call("PUT", `/fuel/${record.id}`, { liters: 5 }), 409, "FUEL_RECORD_ARCHIVED");
      const entries = (await auditFor(record.id)).sort((a, b) => Number(a.id) - Number(b.id));
      assert.deepEqual(entries.map((e) => e.action), ["fuel.created", "fuel.updated", "fuel.archived"]);
      assert.equal(String(entries[0].actor_id), staff.id);
      assert.equal(entries[0].after_data.busId, bus.id);
      assert.deepEqual(entries[1].before_data, { liters: "40.00" });
      assert.deepEqual(entries[1].after_data, { liters: "41.00" });
      assert.equal(String(entries[1].actor_id), manager.id);
      assert.deepEqual(entries[2].after_data, { isArchived: true });
    });

    await t.test("a failed audit write leaves no record behind", async () => {
      const bus = await newBus();
      await assert.rejects(
        createFuelRecord({ input: payload(bus.id), actorId: "1", actorEmail: "not-an-email" }),
        /INVALID_AUDIT_ACTOR/,
      );
      assert.equal(await countFor(bus.id), 0);
      await failsWith(add(bus.id, { liters: 0 }), 400, "INVALID_LITERS");
      assert.equal(await countFor(bus.id), 0);
    });

    await t.test("concurrent writes can never leave a decreasing odometer sequence", async () => {
      for (let round = 0; round < 5; round += 1) {
        const bus = await newBus();
        await added(bus.id, { purchaseDate: day(0), odometer: 20000 });
        // 20100 on the earlier date and 20050 on the later date contradict each other.
        const results = await Promise.all([
          add(bus.id, { purchaseDate: day(5), odometer: 20100 }),
          add(bus.id, { purchaseDate: day(6), odometer: 20050 }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], JSON.stringify(results.map((r) => r.body)));
        const rows = (await pool.query(
          "SELECT odometer FROM fuel_purchases WHERE bus_id = $1 AND archived_at IS NULL ORDER BY purchase_date, id", [bus.id],
        )).rows.map((r) => r.odometer);
        assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
      }
      // Concurrent edits of two neighbours towards each other.
      const bus = await newBus();
      const a = await added(bus.id, { purchaseDate: day(0), odometer: 100 });
      const b = await added(bus.id, { purchaseDate: day(5), odometer: 200 });
      const results = await Promise.all([
        staff.call("PUT", `/fuel/${a.id}`, { odometer: 190 }),
        staff.call("PUT", `/fuel/${b.id}`, { odometer: 150 }),
      ]);
      const rows = (await pool.query(
        "SELECT odometer FROM fuel_purchases WHERE bus_id = $1 ORDER BY purchase_date", [bus.id],
      )).rows.map((r) => r.odometer);
      assert.ok(rows[0] <= rows[1], JSON.stringify([results.map((r) => r.body), rows]));
    });

    await t.test("permissions", async () => {
      const bus = await newBus();
      const record = await added(bus.id);
      const reads = ["/fuel", `/fuel/summary?startDate=${day(0)}&endDate=${day(1)}`, `/fuel/${record.id}`, `/fuel/bus/${bus.id}`];
      const writes = [
        ["POST", "/fuel", payload(bus.id, { purchaseDate: day(50), odometer: 99000 })],
        ["PUT", `/fuel/${record.id}`, { liters: 1 }],
        ["POST", `/fuel/${record.id}/archive`],
      ];
      const denied = (session, method, path, body) =>
        failsWith(session(method, path, body), 403, "INSUFFICIENT_PERMISSION");

      for (const path of reads) assert.equal((await fetch(`${base}${path}`)).status, 401, path);
      for (const [method, path] of writes) assert.equal((await fetch(`${base}${path}`, { method })).status, 401);

      for (const session of [admin, staff.call, manager.call]) {
        for (const path of reads) await ok(session("GET", path));
      }
      for (const role of ["driver", "applicant", "passenger", null]) {
        const { call } = await account(role);
        for (const path of reads) await denied(call, "GET", path);
        for (const write of writes) await denied(call, ...write);
      }
      // Archiving needs archive-fuel, which only Admin holds.
      await denied(staff.call, "POST", `/fuel/${record.id}/archive`);
      await denied(manager.call, "POST", `/fuel/${record.id}/archive`);
      // CSRF is required on every mutation, even for a permitted role.
      for (const [method, path, body] of writes) {
        await failsWith(staff.call(method, path, body, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      }
      await failsWith(admin("POST", `/fuel/${record.id}/archive`, undefined, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      await failsWith(staff.call("POST", "/fuel", payload(bus.id), { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      assert.equal((await ok(admin("GET", `/fuel/${record.id}`))).isArchived, false);
      // Admin has full access.
      await ok(admin("PUT", `/fuel/${record.id}`, { liters: 2 }));
      await ok(admin("POST", `/fuel/${record.id}/archive`));
    });

    await t.test("database constraints hold even without the application", async () => {
      const bus = await newBus();
      const insert = (date, odometer, liters = "5.00", cost = "5.00") => pool.query(
        `INSERT INTO fuel_purchases (bus_id, purchase_date, liters, total_cost, odometer, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 1, 1)`,
        [bus.id, date, liters, cost, odometer],
      );
      await insert(day(0), 1000); // baseline is valid
      await assert.rejects(insert(day(1), 1000, "0.00"), { code: "23514" });
      await assert.rejects(insert(day(1), 1000, "-1.00"), { code: "23514" });
      await assert.rejects(insert(day(1), 1000, "5.00", "-1.00"), { code: "23514" });
      await assert.rejects(insert(day(1), -1), { code: "23514" });
      // The trigger blocks an inconsistent sequence written straight into the table.
      await assert.rejects(insert(day(2), 999), { code: "23514", constraint: "fuel_purchases_odometer_sequence" });
      await assert.rejects(insert(day(-1), 1001), { code: "23514", constraint: "fuel_purchases_odometer_sequence" });
      await insert(day(0), 5); // same date is allowed
      assert.equal(await countFor(bus.id), 2);
    });

    const { rows } = await pool.query("SELECT current_user AS role");
    await t.test("runtime role cannot delete fuel records",
      { skip: rows[0].role !== "bus_app" && "DATABASE_URL does not use the bus_app role" }, async () => {
        for (const sql of ["DELETE FROM fuel_purchases WHERE FALSE", "TRUNCATE fuel_purchases"]) {
          await assert.rejects(pool.query(sql), { code: "42501" }, sql);
        }
      });
  } finally {
    // Records are never deleted: test buses are archived and accounts deactivated.
    if (admin) {
      for (const id of created.buses) await admin("POST", `/buses/${id}/archive`);
      for (const id of created.accounts) await admin("PATCH", `/accounts/${id}/status`, { isActive: false });
    }
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});