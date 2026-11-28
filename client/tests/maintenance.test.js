import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, setCsrfToken } from "../src/services/api.js";
import {
  archiveMaintenance,
  createMaintenance,
  getBusMaintenanceHistory,
  getMaintenance,
  listMaintenance,
  listOverdueMaintenance,
  listUpcomingMaintenance,
  updateMaintenance,
} from "../src/features/maintenance/maintenanceApi.js";
import {
  diffRecord,
  dueMessage,
  formatCost,
  hasEdits,
  maintenanceErrorMessage,
  normalizeCost,
  toCreatePayload,
  validateMaintenanceForm,
  valuesFromRecord,
} from "../src/features/maintenance/maintenanceModel.js";
import { CAPABILITIES, can } from "../src/utils/permissions.js";

const valid = {
  busId: "1",
  serviceDate: "2026-11-01",
  maintenanceType: "  Oil   change ",
  workDescription: "Changed oil and filter",
  cost: "150.5",
  odometer: "12000",
  nextServiceDate: "2027-02-01",
};
const errorsFor = (overrides, mode = "create") =>
  validateMaintenanceForm({ ...valid, ...overrides }, mode).errors;

const record = {
  id: "5",
  busId: "1",
  busNumber: "BUS-101",
  serviceDate: "2026-11-01",
  maintenanceType: "Oil change",
  workDescription: "Changed oil",
  cost: "150.00",
  odometer: 12000,
  nextServiceDate: "2027-02-01",
  dueStatus: "none",
  isArchived: false,
};

test("a valid form is normalised", () => {
  const { errors, input } = validateMaintenanceForm(valid, "create");
  assert.deepEqual(errors, {});
  assert.deepEqual(input, {
    serviceDate: "2026-11-01",
    maintenanceType: "Oil change",
    workDescription: "Changed oil and filter",
    cost: "150.50",
    odometer: 12000,
    nextServiceDate: "2027-02-01",
  });
});

test("required fields are enforced", () => {
  const errors = errorsFor({
    busId: "", serviceDate: "", maintenanceType: " ", workDescription: "", cost: "",
  });
  for (const key of ["busId", "serviceDate", "maintenanceType", "workDescription", "cost"]) {
    assert.ok(errors[key], key);
  }
  assert.equal(errorsFor({ busId: "" }, "edit").busId, undefined);
});

test("negative and malformed cost or odometer are rejected", () => {
  assert.match(errorsFor({ cost: "-1" }).cost, /negative/);
  for (const cost of ["1.234", "abc", "10000000000", "1e3"]) assert.ok(errorsFor({ cost }).cost, cost);
  assert.equal(errorsFor({ cost: "0" }).cost, undefined);
  assert.match(errorsFor({ odometer: "-5" }).odometer, /negative/);
  for (const odometer of ["1.5", "abc", "10000000"]) assert.ok(errorsFor({ odometer }).odometer, odometer);
  assert.equal(errorsFor({ odometer: "0" }).odometer, undefined);
  assert.equal(errorsFor({ odometer: "" }).odometer, undefined);
});

test("dates must be real and the next date may not precede the service date", () => {
  assert.ok(errorsFor({ serviceDate: "2027-02-30" }).serviceDate);
  assert.ok(errorsFor({ serviceDate: "1899-12-31" }).serviceDate);
  assert.ok(errorsFor({ nextServiceDate: "2027-13-01" }).nextServiceDate);
  assert.match(errorsFor({ nextServiceDate: "2026-10-31" }).nextServiceDate, /earlier/);
  assert.equal(errorsFor({ nextServiceDate: "2026-11-01" }).nextServiceDate, undefined);
  assert.equal(errorsFor({ nextServiceDate: "" }).nextServiceDate, undefined);
});

test("text limits and control characters", () => {
  assert.ok(errorsFor({ maintenanceType: "x".repeat(101) }).maintenanceType);
  assert.ok(errorsFor({ workDescription: "x".repeat(256) }).workDescription);
  assert.ok(errorsFor({ workDescription: "a\nb" }).workDescription);
});

test("cost normalisation and display", () => {
  assert.equal(normalizeCost("150"), "150.00");
  assert.equal(normalizeCost(" 0.5 "), "0.50");
  assert.equal(normalizeCost("-1"), null);
  assert.equal(formatCost(null), "—");
});

test("create payload leaves out empty optional fields", () => {
  const { input } = validateMaintenanceForm({ ...valid, odometer: "", nextServiceDate: "" }, "create");
  assert.deepEqual(toCreatePayload("1", input), {
    busId: "1",
    serviceDate: "2026-11-01",
    maintenanceType: "Oil change",
    workDescription: "Changed oil and filter",
    cost: "150.50",
  });
});

test("edit prepopulates and sends only changed fields, with null to clear", () => {
  const values = valuesFromRecord(record);
  assert.equal(values.odometer, "12000");
  assert.equal(hasEdits(record, values), false);
  assert.equal(hasEdits(record, { ...values, cost: "200" }), true);
  const { input } = validateMaintenanceForm({ ...values, cost: "200", odometer: "", nextServiceDate: "" }, "edit");
  assert.deepEqual(diffRecord(record, input), { cost: "200.00", odometer: null, nextServiceDate: null });
  const same = validateMaintenanceForm(values, "edit").input;
  assert.deepEqual(diffRecord(record, same), {});
});

test("backend error codes map to readable text", () => {
  assert.match(
    maintenanceErrorMessage(new ApiError("NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE", 400)),
    /earlier than the service date/,
  );
  assert.match(maintenanceErrorMessage(new ApiError("MAINTENANCE_ARCHIVED", 409)), /archived/);
  assert.equal(
    maintenanceErrorMessage(new ApiError("INSUFFICIENT_PERMISSION", 403)),
    "You do not have permission to do that.",
  );
});

test("due wording follows the backend classification", () => {
  assert.match(dueMessage({ ...record, dueStatus: "overdue" }), /passed/);
  assert.match(dueMessage({ ...record, dueStatus: "upcoming" }), /today counts as upcoming/);
  assert.match(dueMessage({ ...record, nextServiceDate: null }), /No next service date/);
  assert.match(dueMessage({ ...record, isArchived: true }), /not included/);
});

test("maintenance requests use the shared session API with exact routes", async (t) => {
  const calls = [];
  setCsrfToken("test-token");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
  });
  await listMaintenance({ archived: "false", q: "oil", busId: "", page: "2", limit: "25" });
  await listUpcomingMaintenance({ busId: "3", page: "1", limit: "25" });
  await listOverdueMaintenance({ page: "1", limit: "1" });
  await getBusMaintenanceHistory("4", { page: "1", limit: "10" });
  await getMaintenance("9");
  await createMaintenance({ busId: "1", cost: "1.00" });
  await updateMaintenance("9", { cost: "2.00" });
  await archiveMaintenance("9");
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", "/api/v1/maintenance?archived=false&q=oil&page=2&limit=25"],
      ["GET", "/api/v1/maintenance/upcoming?busId=3&page=1&limit=25"],
      ["GET", "/api/v1/maintenance/overdue?page=1&limit=1"],
      ["GET", "/api/v1/maintenance/bus/4?page=1&limit=10"],
      ["GET", "/api/v1/maintenance/9"],
      ["POST", "/api/v1/maintenance"],
      ["PUT", "/api/v1/maintenance/9"],
      ["POST", "/api/v1/maintenance/9/archive"],
    ],
  );
  for (const call of calls) {
    assert.equal(call.credentials, "include");
    assert.equal(call.headers["X-CSRF-Token"], "test-token");
  }
  assert.deepEqual(JSON.parse(calls[6].body), { cost: "2.00" });
  setCsrfToken(null);
});

test("frontend permission hints match migration 014", () => {
  const has = (role, capability) => can({ role }, capability);
  for (const role of ["admin", "administrative_staff", "transportation_manager"]) {
    assert.equal(has(role, CAPABILITIES.VIEW_MAINTENANCE), true, role);
    assert.equal(has(role, CAPABILITIES.MANAGE_MAINTENANCE), true, role);
  }
  assert.equal(has("admin", CAPABILITIES.ARCHIVE_MAINTENANCE), true);
  assert.equal(has("administrative_staff", CAPABILITIES.ARCHIVE_MAINTENANCE), false);
  assert.equal(has("transportation_manager", CAPABILITIES.ARCHIVE_MAINTENANCE), false);
  for (const role of ["driver", "applicant", "passenger", undefined]) {
    assert.equal(has(role, CAPABILITIES.VIEW_MAINTENANCE), false, String(role));
  }
});