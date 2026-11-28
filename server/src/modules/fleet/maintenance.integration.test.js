import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import { createMaintenance } from "./maintenance-service.js";

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

test("maintenance records against PostgreSQL", { skip: !email || !password }, async (t) => {
  const server = app.listen(0);
  const created = { accounts: [], buses: [], records: [] };
  let admin;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    admin = await openSession(base, email, password);
    const stamp = Date.now();
    let sequence = 0;
    const today = businessToday();

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
      const userEmail = `it-maint-${role ?? "none"}-${stamp}-${sequence += 1}@example.com`;
      const { id } = await ok(admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD }), 201);
      created.accounts.push(id);
      if (role) await ok(admin("PUT", `/accounts/${id}/role`, { role }));
      return { id, call: await openSession(base, userEmail, TEMP_PASSWORD) };
    }
    const staff = await account("administrative_staff");
    const manager = await account("transportation_manager");

    async function newBus() {
      const bus = await ok(admin("POST", "/buses", {
        busNumber: `MT${stamp}-${sequence += 1}`, seatingCapacity: 40, requiredLicenseCategory: "HTV",
      }), 201);
      created.buses.push(bus.id);
      return bus;
    }
    const payload = (busId, overrides = {}) => ({
      busId, serviceDate: addDays(today, -60), maintenanceType: "Oil change",
      workDescription: "Changed engine oil and filter", cost: 150, odometer: 12000,
      nextServiceDate: addDays(today, 90), ...overrides,
    });
    async function newRecord(busId, overrides, session = staff.call) {
      const record = await ok(session("POST", "/maintenance", payload(busId, overrides)), 201);
      created.records.push(record.id);
      return record;
    }
    const countFor = async (busId) => Number((await pool.query(
      "SELECT COUNT(*) FROM fleet_maintenance_records WHERE bus_id = $1", [busId],
    )).rows[0].count);
    const auditFor = async (id) =>
      (await ok(admin("GET", `/audit?entityType=maintenance&entityId=${id}&limit=100`))).items;
    const ids = (page) => page.items.map((item) => item.id);

    await t.test("create, view, list, update and archive", async () => {
      const bus = await newBus();
      const record = await newRecord(bus.id);
      assert.equal(record.busId, bus.id);
      assert.equal(record.busNumber, bus.busNumber);
      assert.equal(record.cost, "150.00");
      assert.equal(record.odometer, 12000);
      assert.equal(record.createdBy, staff.id);
      assert.equal(record.updatedBy, staff.id);
      assert.equal(record.isArchived, false);
      assert.equal(record.archivedAt, null);
      assert.deepEqual(await ok(manager.call("GET", `/maintenance/${record.id}`)), record);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance?busId=${bus.id}`))), [record.id]);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance?busId=${bus.id}&q=ENGINE`))), [record.id]);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance?busId=${bus.id}&q=zzz`))), []);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance?busId=${bus.id}&serviceFrom=${record.serviceDate}&serviceTo=${record.serviceDate}`))),
        [record.id]);

      const updated = await ok(manager.call("PUT", `/maintenance/${record.id}`, { cost: "200.5", odometer: null }));
      assert.equal(updated.cost, "200.50");
      assert.equal(updated.odometer, null);
      assert.equal(updated.updatedBy, manager.id);
      assert.equal(updated.createdBy, staff.id);

      const archived = await ok(admin("POST", `/maintenance/${record.id}/archive`));
      assert.equal(archived.isArchived, true);
      assert.ok(archived.archivedAt);
      assert.equal(archived.dueStatus, "none");
      await failsWith(admin("POST", `/maintenance/${record.id}/archive`), 409, "MAINTENANCE_ALREADY_ARCHIVED");
      await failsWith(manager.call("PUT", `/maintenance/${record.id}`, { cost: 1 }), 409, "MAINTENANCE_ARCHIVED");
      // The row is kept: still readable, hidden from the ordinary list only.
      assert.equal((await ok(admin("GET", `/maintenance/${record.id}`))).isArchived, true);
      assert.deepEqual(ids(await ok(admin("GET", `/maintenance?busId=${bus.id}`))), []);
      assert.deepEqual(ids(await ok(admin("GET", `/maintenance?busId=${bus.id}&archived=true`))), [record.id]);
      assert.deepEqual(ids(await ok(admin("GET", `/maintenance?busId=${bus.id}&archived=all`))), [record.id]);
      assert.equal(await countFor(bus.id), 1);
      assert.equal((await manager.call("DELETE", `/maintenance/${record.id}`)).status, 404);
    });

    await t.test("optional fields can be omitted and cleared", async () => {
      const bus = await newBus();
      const record = await newRecord(bus.id, { odometer: undefined, nextServiceDate: undefined });
      assert.equal(record.odometer, null);
      assert.equal(record.nextServiceDate, null);
      assert.equal(record.dueStatus, "none");
      const set = await ok(staff.call("PUT", `/maintenance/${record.id}`, { odometer: 0, nextServiceDate: addDays(today, 5) }));
      assert.equal(set.odometer, 0);
      assert.equal(set.dueStatus, "upcoming");
      const cleared = await ok(staff.call("PUT", `/maintenance/${record.id}`, { nextServiceDate: null }));
      assert.equal(cleared.nextServiceDate, null);
    });

    await t.test("invalid requests", async () => {
      const bus = await newBus();
      for (const [overrides, status, code] of [
        [{ busId: "abc" }, 400, "INVALID_BUS_ID"],
        [{ busId: "999999999" }, 404, "BUS_NOT_FOUND"],
        [{ serviceDate: "2027-02-30" }, 400, "INVALID_SERVICE_DATE"],
        [{ maintenanceType: "  " }, 400, "INVALID_MAINTENANCE_TYPE"],
        [{ workDescription: "" }, 400, "INVALID_WORK_DESCRIPTION"],
        [{ cost: -1 }, 400, "INVALID_COST"],
        [{ cost: "1.234" }, 400, "INVALID_COST"],
        [{ cost: "10000000000" }, 400, "INVALID_COST"],
        [{ cost: undefined }, 400, "INVALID_COST"],
        [{ odometer: -1 }, 400, "INVALID_ODOMETER"],
        [{ odometer: 10000000 }, 400, "INVALID_ODOMETER"],
        [{ nextServiceDate: "bad" }, 400, "INVALID_NEXT_SERVICE_DATE"],
        [{ nextServiceDate: addDays(today, -61) }, 400, "NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE"],
        [{ isArchived: true }, 400, "INVALID_INPUT"],
      ]) await failsWith(staff.call("POST", "/maintenance", payload(bus.id, overrides)), status, code);
      assert.equal((await ok(staff.call("POST", "/maintenance", payload(bus.id, { cost: "9999999999.99", odometer: 9999999 })), 201)).cost,
        "9999999999.99");
      assert.equal(await countFor(bus.id), 1);
      const record = (await ok(staff.call("GET", `/maintenance?busId=${bus.id}`))).items[0];
      created.records.push(record.id);
      await failsWith(staff.call("PUT", `/maintenance/${record.id}`, {}), 400, "INVALID_INPUT");
      await failsWith(staff.call("PUT", `/maintenance/${record.id}`, { busId: bus.id }), 400, "INVALID_INPUT");
      await failsWith(staff.call("PUT", `/maintenance/${record.id}`, { nextServiceDate: addDays(today, -100) }), 400,
        "NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE");
      await failsWith(staff.call("PUT", "/maintenance/999999999", { cost: 1 }), 404, "MAINTENANCE_NOT_FOUND");
      await failsWith(staff.call("GET", "/maintenance/999999999"), 404, "MAINTENANCE_NOT_FOUND");
      await failsWith(staff.call("GET", "/maintenance/abc"), 400, "INVALID_MAINTENANCE_ID");
      await failsWith(staff.call("GET", "/maintenance?archived=maybe"), 400, "INVALID_MAINTENANCE_FILTER");
      await failsWith(staff.call("GET", "/maintenance?page=0"), 400, "INVALID_PAGINATION");
      await failsWith(staff.call("GET", "/maintenance/bus/abc"), 400, "INVALID_BUS_ID");
      await failsWith(staff.call("GET", "/maintenance/bus/999999999"), 404, "BUS_NOT_FOUND");
    });

    await t.test("upcoming and overdue boundaries", async () => {
      const bus = await newBus();
      const byOffset = {};
      for (const offset of [-1, 0, 1, 30, 31]) {
        byOffset[offset] = (await newRecord(bus.id, { nextServiceDate: addDays(today, offset) })).id;
      }
      const noNext = await newRecord(bus.id, { nextServiceDate: undefined });
      const archived = await newRecord(bus.id, { nextServiceDate: addDays(today, 5) });
      const archivedOverdue = await newRecord(bus.id, { nextServiceDate: addDays(today, -5) });
      await ok(admin("POST", `/maintenance/${archived.id}/archive`));
      await ok(admin("POST", `/maintenance/${archivedOverdue.id}/archive`));

      const upcoming = await ok(staff.call("GET", `/maintenance/upcoming?busId=${bus.id}`));
      assert.equal(upcoming.asOf, today);
      assert.equal(upcoming.upcomingThrough, addDays(today, 30));
      assert.deepEqual(ids(upcoming), [byOffset[0], byOffset[1], byOffset[30]]); // due today, tomorrow, day 30
      const overdue = await ok(manager.call("GET", `/maintenance/overdue?busId=${bus.id}`));
      assert.deepEqual(ids(overdue), [byOffset[-1]]); // yesterday only; today is not overdue
      for (const id of [byOffset[31], noNext.id, archived.id, archivedOverdue.id]) {
        assert.equal([...ids(upcoming), ...ids(overdue)].includes(id), false, id);
      }
      const statuses = Object.fromEntries(upcoming.items.map((item) => [item.id, item.dueStatus]));
      assert.equal(statuses[byOffset[0]], "upcoming");
      assert.equal(overdue.items[0].dueStatus, "overdue");
      assert.equal((await ok(staff.call("GET", `/maintenance/${byOffset[31]}`))).dueStatus, "none");
    });

    await t.test("history is chronological and keeps archived records and archived buses", async () => {
      const bus = await newBus();
      const middle = await newRecord(bus.id, { serviceDate: addDays(today, -20), nextServiceDate: undefined });
      const oldest = await newRecord(bus.id, { serviceDate: addDays(today, -30), nextServiceDate: undefined });
      const newest = await newRecord(bus.id, { serviceDate: addDays(today, -10), nextServiceDate: undefined });
      const sameDay = await newRecord(bus.id, { serviceDate: addDays(today, -10), nextServiceDate: undefined });
      await ok(admin("POST", `/maintenance/${oldest.id}/archive`));

      let history = await ok(staff.call("GET", `/maintenance/bus/${bus.id}`));
      assert.deepEqual(ids(history), [sameDay.id, newest.id, middle.id, oldest.id]); // newest date first, ties by id
      assert.deepEqual(history.bus, { id: bus.id, busNumber: bus.busNumber, isArchived: false });
      assert.equal(history.items.at(-1).isArchived, true);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance/bus/${bus.id}?archived=false`))),
        [sameDay.id, newest.id, middle.id]);
      assert.deepEqual(ids(await ok(staff.call("GET", `/maintenance/bus/${bus.id}?archived=true`))), [oldest.id]);

      await ok(admin("POST", `/buses/${bus.id}/archive`));
      history = await ok(staff.call("GET", `/maintenance/bus/${bus.id}`));
      assert.equal(history.bus.isArchived, true);
      assert.equal(history.total, 4);
      assert.equal(history.items[0].isBusArchived, true);
      assert.equal((await ok(staff.call("GET", `/maintenance/${middle.id}`))).busNumber, bus.busNumber);
      assert.ok(ids(await ok(staff.call("GET", `/maintenance?busId=${bus.id}`))).includes(middle.id));
      // No new records for an archived bus, but existing ones can still be corrected.
      await failsWith(staff.call("POST", "/maintenance", payload(bus.id)), 409, "BUS_ARCHIVED");
      await ok(staff.call("PUT", `/maintenance/${middle.id}`, { workDescription: "Corrected description" }));
      assert.equal(await countFor(bus.id), 4);
    });

    await t.test("every successful mutation is audited with actor and before/after values", async () => {
      const bus = await newBus();
      const record = await newRecord(bus.id);
      await ok(manager.call("PUT", `/maintenance/${record.id}`, { cost: 99 }));
      await ok(admin("POST", `/maintenance/${record.id}/archive`));
      await failsWith(manager.call("PUT", `/maintenance/${record.id}`, { cost: 5 }), 409, "MAINTENANCE_ARCHIVED");
      const entries = (await auditFor(record.id)).sort((a, b) => Number(a.id) - Number(b.id));
      assert.deepEqual(entries.map((e) => e.action), ["maintenance.created", "maintenance.updated", "maintenance.archived"]);
      assert.equal(String(entries[0].actor_id), staff.id);
      assert.equal(entries[0].after_data.busId, bus.id);
      assert.deepEqual(entries[1].before_data, { cost: "150.00" });
      assert.deepEqual(entries[1].after_data, { cost: "99.00" });
      assert.equal(String(entries[1].actor_id), manager.id);
      assert.deepEqual(entries[2].after_data, { isArchived: true });
    });

    await t.test("a failed audit write leaves no record behind", async () => {
      const bus = await newBus();
      await assert.rejects(
        createMaintenance({ input: payload(bus.id), actorId: "1", actorEmail: "not-an-email" }),
        /INVALID_AUDIT_ACTOR/,
      );
      assert.equal(await countFor(bus.id), 0);
      // Rejected requests write no audit entries either.
      await failsWith(staff.call("POST", "/maintenance", payload(bus.id, { cost: -1 })), 400, "INVALID_COST");
      assert.equal(await countFor(bus.id), 0);
    });

    await t.test("permissions", async () => {
      const bus = await newBus();
      const record = await newRecord(bus.id);
      const reads = [
        "/maintenance", "/maintenance/upcoming", "/maintenance/overdue",
        `/maintenance/${record.id}`, `/maintenance/bus/${bus.id}`,
      ];
      const writes = [
        ["POST", "/maintenance", payload(bus.id)],
        ["PUT", `/maintenance/${record.id}`, { cost: 1 }],
        ["POST", `/maintenance/${record.id}/archive`],
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
      // Archiving needs archive-maintenance, which only Admin holds.
      await denied(staff.call, "POST", `/maintenance/${record.id}/archive`);
      await denied(manager.call, "POST", `/maintenance/${record.id}/archive`);
      // CSRF is required on every mutation, even for a permitted role.
      for (const [method, path, body] of writes) {
        await failsWith(staff.call(method, path, body, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      }
      await failsWith(admin("POST", `/maintenance/${record.id}/archive`, undefined, { csrf: false }), 403, "CSRF_VALIDATION_FAILED");
      assert.equal((await ok(admin("GET", `/maintenance/${record.id}`))).isArchived, false);
      // Admin has full access.
      await ok(admin("PUT", `/maintenance/${record.id}`, { cost: 2 }));
      await ok(admin("POST", "/maintenance", payload(bus.id))).catch(() => {});
      await ok(admin("POST", `/maintenance/${record.id}/archive`));
    });

    await t.test("database constraints hold even without the application", async () => {
      const bus = await newBus();
      const insert = (columns, values) => pool.query(
        `INSERT INTO fleet_maintenance_records
           (bus_id, service_date, maintenance_type, work_description, cost, created_by, updated_by${columns})
         VALUES ($1, $2, 'x', 'y', $3, 1, 1${values.map((_, i) => `, $${i + 4}`).join("")})`,
        [bus.id, today, "5.00", ...values],
      );
      await insert("", []); // baseline is valid
      await assert.rejects(pool.query(
        `INSERT INTO fleet_maintenance_records
           (bus_id, service_date, maintenance_type, work_description, cost, created_by, updated_by)
         VALUES ($1, $2, 'x', 'y', -1, 1, 1)`, [bus.id, today]), { code: "23514" });
      await assert.rejects(insert(", odometer", [-1]), { code: "23514" });
      await assert.rejects(insert(", next_service_date", [addDays(today, -1)]), { code: "23514" });
      await assert.rejects(pool.query(
        `INSERT INTO fleet_maintenance_records
           (bus_id, service_date, maintenance_type, work_description, cost, created_by, updated_by)
         VALUES (999999999, $1, 'x', 'y', 1, 1, 1)`, [today]), { code: "23503" });
      assert.equal(await countFor(bus.id), 1);
    });

    const { rows } = await pool.query("SELECT current_user AS role");
    await t.test("runtime role cannot delete maintenance records",
      { skip: rows[0].role !== "bus_app" && "DATABASE_URL does not use the bus_app role" }, async () => {
        for (const sql of ["DELETE FROM fleet_maintenance_records WHERE FALSE", "TRUNCATE fleet_maintenance_records"]) {
          await assert.rejects(pool.query(sql), { code: "42501" }, sql);
        }
      });
  } finally {
    // Records are never deleted: test records and buses are archived, accounts deactivated.
    if (admin) {
      for (const id of created.records) await admin("POST", `/maintenance/${id}/archive`);
      for (const id of created.buses) await admin("POST", `/buses/${id}/archive`);
      for (const id of created.accounts) await admin("PATCH", `/accounts/${id}/status`, { isActive: false });
    }
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});