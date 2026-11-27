import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  archiveDriver, createDriver, getDriver, listDrivers, listLicenseExpiry, setDriverStatus, updateDriver,
} from "./service.js";

const actor = { actorId: "7", actorEmail: "manager@example.com" };
const input = {
  fullName: "Ali Raza", licenseNumber: "lhr-123", licenseCategory: "htv", licenseExpiryDate: "2027-05-31",
};

function row(overrides = {}) {
  return {
    id: "5", full_name: "Ali Raza", license_number: "LHR-123", license_category: "HTV",
    license_expiry_date: "2027-05-31", status: "available", is_archived: false, archived_at: null,
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

// Locks return `before`; the UPDATE returns `after`.
const locked = (t, before, after) => useClient(t, (sql) => {
  if (sql.includes("FOR UPDATE")) return { rows: before ? [before] : [] };
  if (sql.includes("UPDATE drivers_drivers")) return { rows: [after] };
  return null;
});

const sqls = (client) => client.calls.map((c) => c.sql);
const audits = (client) => client.calls
  .filter((c) => c.sql.includes("INSERT INTO audit_logs"))
  .map(({ values }) => ({
    action: values[2], entity: values[3], id: values[4],
    before: values[5] && JSON.parse(values[5]), after: values[6] && JSON.parse(values[6]),
  }));
const noWrite = (client) => {
  assert.equal(sqls(client).some((s) => /^\s*(UPDATE|INSERT)/.test(s)), false);
};

test("createDriver inserts normalized values and audits in the same transaction", async (t) => {
  const client = useClient(t, (sql) => (sql.includes("INSERT INTO drivers_drivers") ? { rows: [row()] } : null));
  const driver = await createDriver({ input, ...actor });
  assert.equal(driver.licenseExpiryDate, "2027-05-31");
  assert.deepEqual(client.calls[1].values, ["Ali Raza", "LHR-123", "HTV", "2027-05-31", "available"]);
  assert.equal(sqls(client)[0], "BEGIN");
  assert.match(sqls(client)[2], /INSERT INTO audit_logs/);
  assert.equal(sqls(client).at(-1), "COMMIT");
  assert.deepEqual(audits(client), [{
    action: "driver.created", entity: "driver", id: "5", before: null,
    after: {
      fullName: "Ali Raza", licenseNumber: "LHR-123", licenseCategory: "HTV",
      licenseExpiryDate: "2027-05-31", status: "available", isArchived: false,
    },
  }]);
});

test("createDriver rolls back when the audit insert fails", async (t) => {
  const client = useClient(t, (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) throw new Error("audit down");
    return { rows: [row()] };
  });
  await assert.rejects(createDriver({ input, ...actor }), /audit down/);
  assert.equal(sqls(client).at(-1), "ROLLBACK");
  assert.equal(sqls(client).includes("COMMIT"), false);
});

const violation = (constraint) => Object.assign(new Error("duplicate"), { code: "23505", constraint });

test("duplicate license numbers map to 409 on create and update", async (t) => {
  useClient(t, (sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [row()] };
    throw violation("drivers_drivers_license_key");
  });
  const expected = { code: "DRIVER_LICENSE_ALREADY_EXISTS", status: 409 };
  await assert.rejects(createDriver({ input, ...actor }), expected);
  await assert.rejects(updateDriver({ id: "5", input: { licenseNumber: "X-1" }, ...actor }), expected);
});

test("other unique violations are not reported as duplicate licenses", async (t) => {
  useClient(t, () => { throw violation("something_else"); });
  await assert.rejects(createDriver({ input, ...actor }), { code: "23505" });
});

test("invalid input never opens a transaction", async (t) => {
  const connect = t.mock.method(pool, "connect", async () => assert.fail("must not connect"));
  await assert.rejects(createDriver({ input: { ...input, licenseNumber: "" }, ...actor }), { code: "INVALID_LICENSE_NUMBER" });
  await assert.rejects(setDriverStatus({ id: "5", input: { status: "busy" }, ...actor }), { code: "INVALID_DRIVER_STATUS" });
  assert.equal(connect.mock.callCount(), 0);
});

test("a profile and license change produces two audit events with only changed fields", async (t) => {
  const client = locked(t, row(), row({ full_name: "Ali Khan", license_expiry_date: "2028-05-31" }));
  await updateDriver({
    id: "5", input: { fullName: "Ali Khan", licenseCategory: "HTV", licenseExpiryDate: "2028-05-31" }, ...actor,
  });
  assert.deepEqual(audits(client), [
    { action: "driver.updated", entity: "driver", id: "5", before: { fullName: "Ali Raza" }, after: { fullName: "Ali Khan" } },
    {
      action: "driver.license_updated", entity: "driver", id: "5",
      before: { licenseExpiryDate: "2027-05-31" }, after: { licenseExpiryDate: "2028-05-31" },
    },
  ]);
  assert.equal(sqls(client).at(-1), "COMMIT");
});

test("an update with no real change writes nothing", async (t) => {
  const client = locked(t, row(), row());
  await updateDriver({ id: "5", input: { licenseNumber: " lhr-123 " }, ...actor });
  noWrite(client);
});

test("status change is audited; an unchanged status is not", async (t) => {
  const client = locked(t, row(), row({ status: "on_leave" }));
  await setDriverStatus({ id: "5", input: { status: "on_leave" }, ...actor });
  assert.deepEqual(audits(client), [{
    action: "driver.status_changed", entity: "driver", id: "5",
    before: { status: "available" }, after: { status: "on_leave" },
  }]);
  const same = locked(t, row(), row());
  await setDriverStatus({ id: "5", input: { status: "available" }, ...actor });
  noWrite(same);
});

test("archiveDriver updates (never deletes) and audits", async (t) => {
  const client = locked(t, row(), row({ is_archived: true, archived_at: new Date() }));
  assert.equal((await archiveDriver({ id: "5", ...actor })).isArchived, true);
  assert.equal(sqls(client).some((s) => /DELETE/i.test(s)), false);
  assert.deepEqual(audits(client), [{
    action: "driver.archived", entity: "driver", id: "5",
    before: { isArchived: false }, after: { isArchived: true },
  }]);
});

test("archived drivers cannot be edited, change status or be archived again", async (t) => {
  const client = locked(t, row({ is_archived: true, archived_at: new Date() }));
  await assert.rejects(updateDriver({ id: "5", input: { fullName: "B" }, ...actor }), { code: "DRIVER_ARCHIVED", status: 409 });
  await assert.rejects(setDriverStatus({ id: "5", input: { status: "absent" }, ...actor }), { code: "DRIVER_ARCHIVED" });
  await assert.rejects(archiveDriver({ id: "5", ...actor }), { code: "DRIVER_ALREADY_ARCHIVED", status: 409 });
  noWrite(client);
});

test("missing drivers produce 404", async (t) => {
  locked(t, null);
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const expected = { code: "DRIVER_NOT_FOUND", status: 404 };
  await assert.rejects(getDriver("9"), expected);
  await assert.rejects(archiveDriver({ id: "9", ...actor }), expected);
});

function useList(t, rows = []) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => { calls.push({ sql, values }); return { rows }; });
  return calls;
}

test("listDrivers parameterizes filters and treats search text literally", async (t) => {
  const calls = useList(t);
  await listDrivers({ q: "a%_b", status: "absent", licenseCategory: "htv" });
  assert.deepEqual(calls[0].values, [false, "absent", "HTV", "%a\\%\\_b%", "%A\\%\\_B%", 25, 0]);
  assert.equal(calls[0].sql.includes("a%_b"), false);
});

test("license search ignores separators, and separator-only text does not match every license", async (t) => {
  const calls = useList(t);
  await listDrivers({ q: "lhr 12-3" });
  assert.ok(calls[0].values.includes("%LHR123%"));
  await listDrivers({ q: "-" });
  assert.equal(calls[1].sql.includes("translate("), false);
});

test("expiry queries use the business date and the inclusive 30-day window", async (t) => {
  // 20:00 UTC on 15 December is already 16 December in Asia/Karachi.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-15T20:00:00Z") });
  const calls = useList(t);
  const soon = await listLicenseExpiry({});
  assert.equal(soon.asOf, "2026-12-16");
  assert.equal(soon.expiringSoonThrough, "2027-01-15");
  assert.match(calls[0].sql, /license_expiry_date >= \$2::date AND license_expiry_date <= \$3::date/);
  assert.deepEqual(calls[0].values.slice(0, 3), [false, "2026-12-16", "2027-01-15"]);

  await listLicenseExpiry({ state: "expired" });
  assert.match(calls[1].sql, /license_expiry_date < \$2::date/);
  await listLicenseExpiry({ state: "valid" });
  assert.match(calls[2].sql, /license_expiry_date >= \$2::date/);
  assert.equal(calls[2].sql.includes("license_expiry_date <="), false);
});
