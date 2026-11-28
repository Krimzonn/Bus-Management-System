import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, setCsrfToken } from "../src/services/api.js";
import {
  archiveFuel,
  createFuel,
  getBusFuelHistory,
  getFuelRecord,
  getFuelSummary,
  listFuel,
  updateFuel,
} from "../src/features/fuel/fuelApi.js";
import {
  describeEfficiency,
  diffRecord,
  formatCost,
  FIELD_FOR_CODE,
  fuelErrorMessage,
  hasEdits,
  normalizeCost,
  normalizeLiters,
  toCreatePayload,
  validateFuelForm,
  valuesFromRecord,
} from "../src/features/fuel/fuelModel.js";
import { CAPABILITIES, can } from "../src/utils/permissions.js";

const valid = {
  busId: "1",
  purchaseDate: "2026-11-01",
  liters: "40.5",
  totalCost: "60",
  odometer: "10500",
};
const errorsFor = (overrides, mode = "create") =>
  validateFuelForm({ ...valid, ...overrides }, mode).errors;

const record = {
  id: "5",
  busId: "1",
  busNumber: "BUS-101",
  purchaseDate: "2026-11-01",
  liters: "40.00",
  totalCost: "60.00",
  odometer: 10500,
  isArchived: false,
};

test("a valid form is normalised", () => {
  const { errors, input } = validateFuelForm(valid, "create");
  assert.deepEqual(errors, {});
  assert.deepEqual(input, {
    purchaseDate: "2026-11-01",
    liters: "40.50",
    totalCost: "60.00",
    odometer: 10500,
  });
});

test("required fields are enforced", () => {
  const errors = errorsFor({ busId: "", purchaseDate: "", liters: "", totalCost: "", odometer: "" });
  for (const key of ["busId", "purchaseDate", "liters", "totalCost", "odometer"]) {
    assert.ok(errors[key], key);
  }
  assert.equal(errorsFor({ busId: "" }, "edit").busId, undefined);
});

test("liters must be greater than zero", () => {
  for (const liters of ["0", "0.00", "-1", "-0.5"]) {
    assert.match(errorsFor({ liters }).liters, /greater than zero/, liters);
  }
  for (const liters of ["abc", "1.234", "1e3", "123456789"]) assert.ok(errorsFor({ liters }).liters, liters);
  assert.equal(errorsFor({ liters: "0.01" }).liters, undefined);
});

test("total cost may be zero but never negative", () => {
  assert.equal(errorsFor({ totalCost: "0" }).totalCost, undefined);
  assert.match(errorsFor({ totalCost: "-1" }).totalCost, /negative/);
  for (const totalCost of ["1.234", "abc", "10000000000"]) assert.ok(errorsFor({ totalCost }).totalCost, totalCost);
});

test("odometer is required, whole, non-negative and bounded", () => {
  assert.equal(errorsFor({ odometer: "0" }).odometer, undefined);
  assert.equal(errorsFor({ odometer: "9999999" }).odometer, undefined);
  assert.match(errorsFor({ odometer: "-5" }).odometer, /negative/);
  for (const odometer of ["1.5", "abc", "10000000", ""]) assert.ok(errorsFor({ odometer }).odometer, odometer);
});

test("purchase date must be a real calendar date in range", () => {
  assert.ok(errorsFor({ purchaseDate: "2027-02-30" }).purchaseDate);
  assert.ok(errorsFor({ purchaseDate: "1899-12-31" }).purchaseDate);
  assert.ok(errorsFor({ purchaseDate: "9999-12-31" }).purchaseDate);
  assert.equal(errorsFor({ purchaseDate: "2028-02-29" }).purchaseDate, undefined);
});

test("decimal normalisation and display", () => {
  assert.equal(normalizeLiters("40"), "40.00");
  assert.equal(normalizeLiters(" 0.5 "), "0.50");
  assert.equal(normalizeLiters("100000000"), null);
  assert.equal(normalizeCost("9999999999.99"), "9999999999.99");
  assert.equal(formatCost(null), "—");
});

test("create payload carries the bus and every field", () => {
  const { input } = validateFuelForm(valid, "create");
  assert.deepEqual(toCreatePayload("1", input), {
    busId: "1",
    purchaseDate: "2026-11-01",
    liters: "40.50",
    totalCost: "60.00",
    odometer: 10500,
  });
});

test("edit prepopulates and sends only changed fields", () => {
  const values = valuesFromRecord(record);
  assert.equal(values.odometer, "10500");
  assert.equal(values.liters, "40.00");
  assert.equal(hasEdits(record, values), false);
  assert.equal(hasEdits(record, { ...values, odometer: "10700" }), true);
  assert.equal(hasEdits(record, { ...values, liters: "abc" }), true);
  const { input } = validateFuelForm({ ...values, liters: "25", odometer: "10700" }, "edit");
  assert.deepEqual(diffRecord(record, input), { liters: "25.00", odometer: 10700 });
  assert.deepEqual(diffRecord(record, validateFuelForm(values, "edit").input), {});
});

test("odometer errors from the backend are shown in full and flagged on the odometer field", () => {
  for (const code of ["ODOMETER_BELOW_PREVIOUS", "ODOMETER_ABOVE_NEXT", "ODOMETER_SEQUENCE_VIOLATION"]) {
    const message = fuelErrorMessage(new ApiError(code, 409));
    assert.match(message, /odometer/i, code);
    assert.notEqual(message, "Something went wrong. Please try again.");
    assert.equal(FIELD_FOR_CODE[code], "odometer");
  }
  assert.match(fuelErrorMessage(new ApiError("ODOMETER_BELOW_PREVIOUS", 409)), /must not decrease/);
});

test("other backend error codes map to readable text", () => {
  assert.match(fuelErrorMessage(new ApiError("FUEL_RECORD_ARCHIVED", 409)), /archived/);
  assert.match(fuelErrorMessage(new ApiError("INVALID_DATE_RANGE", 400)), /start date/);
  assert.equal(
    fuelErrorMessage(new ApiError("INSUFFICIENT_PERMISSION", 403)),
    "You do not have permission to do that.",
  );
});

test("efficiency is shown only when the backend says ok; otherwise Insufficient data", () => {
  const ok = describeEfficiency({
    status: "ok", distance: 900, liters: "120.00", distancePerLiter: 7.5, busesIncluded: 2, busesExcluded: 1,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value, "7.5");
  assert.match(ok.note, /2 buses included, 1 without enough data/);
  for (const reason of ["NO_RECORDS", "NOT_ENOUGH_RECORDS", "ZERO_DISTANCE", "INCONSISTENT_ODOMETER"]) {
    const result = describeEfficiency({ status: "insufficient_data", reason, distancePerLiter: null });
    assert.equal(result.ok, false);
    assert.equal(result.value, "Insufficient data");
    assert.ok(result.note.length > 0);
  }
  assert.equal(describeEfficiency(undefined).value, "Insufficient data");
});

test("fuel requests use the shared session API with exact routes", async (t) => {
  const calls = [];
  setCsrfToken("test-token");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
  });
  await listFuel({ archived: "false", busId: "", purchaseFrom: "2026-01-01", page: "2", limit: "25" });
  await getFuelSummary({ startDate: "2026-11-01", endDate: "2026-11-30", busId: "3", archived: "all" });
  await getBusFuelHistory("4", { page: "1", limit: "10" });
  await getFuelRecord("9");
  await createFuel({ busId: "1", liters: "1.00" });
  await updateFuel("9", { liters: "2.00" });
  await archiveFuel("9");
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", "/api/v1/fuel?archived=false&purchaseFrom=2026-01-01&page=2&limit=25"],
      ["GET", "/api/v1/fuel/summary?startDate=2026-11-01&endDate=2026-11-30&busId=3&archived=all"],
      ["GET", "/api/v1/fuel/bus/4?page=1&limit=10"],
      ["GET", "/api/v1/fuel/9"],
      ["POST", "/api/v1/fuel"],
      ["PUT", "/api/v1/fuel/9"],
      ["POST", "/api/v1/fuel/9/archive"],
    ],
  );
  for (const call of calls) {
    assert.equal(call.credentials, "include");
    assert.equal(call.headers["X-CSRF-Token"], "test-token");
  }
  assert.deepEqual(JSON.parse(calls[5].body), { liters: "2.00" });
  setCsrfToken(null);
});

test("frontend permission hints match migration 015", () => {
  const has = (role, capability) => can({ role }, capability);
  for (const role of ["admin", "administrative_staff", "transportation_manager"]) {
    assert.equal(has(role, CAPABILITIES.VIEW_FUEL), true, role);
    assert.equal(has(role, CAPABILITIES.MANAGE_FUEL), true, role);
  }
  assert.equal(has("admin", CAPABILITIES.ARCHIVE_FUEL), true);
  assert.equal(has("administrative_staff", CAPABILITIES.ARCHIVE_FUEL), false);
  assert.equal(has("transportation_manager", CAPABILITIES.ARCHIVE_FUEL), false);
  for (const role of ["driver", "applicant", "passenger", undefined]) {
    assert.equal(has(role, CAPABILITIES.VIEW_FUEL), false, String(role));
    assert.equal(has(role, CAPABILITIES.MANAGE_FUEL), false, String(role));
  }
});