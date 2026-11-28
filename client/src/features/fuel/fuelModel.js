// Constants, validation and formatting for the fuel screens. Validation mirrors
// server/src/modules/fuel/validation.js for early feedback only: the backend
// remains the authority (especially for the odometer sequence). Totals and the
// efficiency estimate are never calculated here; they come from the backend.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const HISTORY_PAGE_SIZE = 10;
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "9999-12-30";
export const MAX_ODOMETER = 9999999;

export const ARCHIVE_VIEWS = [
  { value: "false", label: "Active records" },
  { value: "true", label: "Archived records" },
  { value: "all", label: "All records" },
];

/* ---- Error text. Codes come from the backend; wording lives only here. ---- */

const FUEL_ERRORS = {
  INVALID_BUS_ID: "Choose a valid bus.",
  BUS_NOT_FOUND: "The selected bus no longer exists. Refresh and choose another.",
  BUS_ARCHIVED: "This bus is archived. New fuel records cannot be added to an archived bus.",
  INVALID_PURCHASE_DATE: "Enter a valid purchase date.",
  INVALID_LITERS: "Enter liters greater than zero, with at most 2 decimal places.",
  INVALID_TOTAL_COST: "Enter a total cost of zero or more, with at most 2 decimal places.",
  INVALID_ODOMETER: `Enter a whole number from 0 to ${MAX_ODOMETER.toLocaleString("en-US")}.`,
  INVALID_FUEL_ID: "This fuel record identifier is not valid.",
  INVALID_FUEL_FILTER: "One of the filters is not valid. Check the values and try again.",
  INVALID_DATE_RANGE: "The start date must be on or before the end date.",
  INVALID_PAGINATION: "That page is not available. Go back to the first page and try again.",
  FUEL_RECORD_NOT_FOUND: "This fuel record no longer exists. Refresh the list.",
  FUEL_RECORD_ARCHIVED: "This fuel record is archived and can no longer be changed.",
  FUEL_RECORD_ALREADY_ARCHIVED: "This fuel record is already archived.",
  ODOMETER_BELOW_PREVIOUS:
    "This odometer reading is lower than a reading recorded on an earlier purchase date for this bus. Odometer readings must not decrease over time. Check the reading and the purchase date.",
  ODOMETER_ABOVE_NEXT:
    "This odometer reading is higher than a reading recorded on a later purchase date for this bus. Odometer readings must not decrease over time. Check the reading and the purchase date.",
  ODOMETER_SEQUENCE_VIOLATION:
    "This reading would break the chronological odometer sequence for this bus. Check the reading and the purchase date.",
  INVALID_INPUT: "The fuel details were not accepted. Check the values and try again.",
};

export function fuelErrorMessage(error) {
  if (error instanceof ApiError && Object.hasOwn(FUEL_ERRORS, error.code)) {
    return FUEL_ERRORS[error.code];
  }
  return errorMessage(error);
}

// Errors meaning "your copy of this record is out of date": reload.
export const STALE_CODES = new Set([
  "FUEL_RECORD_NOT_FOUND",
  "FUEL_RECORD_ARCHIVED",
  "FUEL_RECORD_ALREADY_ARCHIVED",
]);

// Which form field a backend error code belongs to.
export const FIELD_FOR_CODE = {
  INVALID_BUS_ID: "busId",
  BUS_NOT_FOUND: "busId",
  BUS_ARCHIVED: "busId",
  INVALID_PURCHASE_DATE: "purchaseDate",
  INVALID_LITERS: "liters",
  INVALID_TOTAL_COST: "totalCost",
  INVALID_ODOMETER: "odometer",
  ODOMETER_BELOW_PREVIOUS: "odometer",
  ODOMETER_ABOVE_NEXT: "odometer",
  ODOMETER_SEQUENCE_VIOLATION: "odometer",
};

/* ---- Dates ---- */

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export const dateInRange = (value) =>
  isCalendarDate(value) && value >= MIN_DATE && value <= MAX_DATE;

/* ---- Normalisation and validation ---- */

// "40.5" -> "40.50". Returns null when the text is not a plain decimal that fits.
export function normalizeDecimal(raw, maxIntegerDigits) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!new RegExp(`^\\d{1,${maxIntegerDigits}}(\\.\\d{1,2})?$`).test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

export const normalizeLiters = (raw) => normalizeDecimal(raw, 8);
export const normalizeCost = (raw) => normalizeDecimal(raw, 10);

export function validatePurchaseDate(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "Enter the purchase date.";
  if (!dateInRange(value)) return "Enter a real date (year 1900 or later).";
  return "";
}

export function validateLiters(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Enter the liters purchased.";
  if (text.startsWith("-")) return "Liters must be greater than zero.";
  const normalized = normalizeLiters(text);
  if (normalized === null) {
    return "Enter liters such as 40 or 40.5 (up to 8 digits and 2 decimals).";
  }
  if (normalized === "0.00") return "Liters must be greater than zero.";
  return "";
}

export function validateTotalCost(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Enter the total cost.";
  if (text.startsWith("-")) return "Total cost cannot be negative.";
  if (normalizeCost(text) === null) {
    return "Enter a cost such as 150 or 150.50 (up to 10 digits and 2 decimals).";
  }
  return "";
}

export function validateOdometer(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Enter the odometer reading.";
  if (text.startsWith("-")) return "Odometer cannot be negative.";
  if (!/^\d{1,15}$/.test(text) || Number(text) > MAX_ODOMETER) {
    return `Enter a whole number from 0 to ${MAX_ODOMETER.toLocaleString("en-US")}.`;
  }
  return "";
}

export const EMPTY_FORM = {
  busId: "",
  purchaseDate: "",
  liters: "",
  totalCost: "",
  odometer: "",
};

export function valuesFromRecord(record) {
  return {
    busId: record.busId,
    purchaseDate: record.purchaseDate,
    liters: record.liters,
    totalCost: record.totalCost,
    odometer: String(record.odometer),
  };
}

// Returns field errors and, when valid, a normalised input (odometer as a number).
export function validateFuelForm(values, mode) {
  const errors = {};
  if (mode === "create" && !values.busId) errors.busId = "Choose a bus.";

  const dateProblem = validatePurchaseDate(values.purchaseDate);
  if (dateProblem) errors.purchaseDate = dateProblem;
  const litersProblem = validateLiters(values.liters);
  if (litersProblem) errors.liters = litersProblem;
  const costProblem = validateTotalCost(values.totalCost);
  if (costProblem) errors.totalCost = costProblem;
  const odometerProblem = validateOdometer(values.odometer);
  if (odometerProblem) errors.odometer = odometerProblem;

  if (Object.keys(errors).length > 0) return { errors, input: null };

  return {
    errors,
    input: {
      purchaseDate: values.purchaseDate.trim(),
      liters: normalizeLiters(values.liters),
      totalCost: normalizeCost(values.totalCost),
      odometer: Number(values.odometer.trim()),
    },
  };
}

export function toCreatePayload(busId, input) {
  return {
    busId,
    purchaseDate: input.purchaseDate,
    liters: input.liters,
    totalCost: input.totalCost,
    odometer: input.odometer,
  };
}

const EDITABLE = ["purchaseDate", "liters", "totalCost", "odometer"];

// Only the fields that differ from the saved record.
export function diffRecord(record, input) {
  const changes = {};
  for (const key of EDITABLE) if (input[key] !== record[key]) changes[key] = input[key];
  return changes;
}

// Cheap check used to disable "Save" before any validation has run.
export function hasEdits(record, values) {
  const liters = normalizeLiters(values.liters);
  const cost = normalizeCost(values.totalCost);
  return (
    values.purchaseDate.trim() !== record.purchaseDate ||
    liters === null ||
    liters !== record.liters ||
    cost === null ||
    cost !== record.totalCost ||
    values.odometer.trim() !== String(record.odometer)
  );
}

/* ---- Formatting ---- */

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDate(value) {
  if (!isCalendarDate(value)) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return dateFmt.format(new Date(year, month - 1, day));
}

export function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "—";
}

function twoDecimals(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const formatLiters = twoDecimals;
// No currency symbol: the application has no configured currency.
export const formatCost = twoDecimals;

// No unit: the application does not define an odometer unit.
export function formatOdometer(value) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}

/* ---- Efficiency (always from the backend) ---- */

export const INSUFFICIENT_DATA = "Insufficient data";
export const EFFICIENCY_UNIT = "odometer units per liter";

const EFFICIENCY_REASONS = {
  NO_RECORDS: "There are no fuel records in this range.",
  NOT_ENOUGH_RECORDS: "At least two fuel records for a bus are needed in the range.",
  ZERO_DISTANCE: "The odometer did not change across the records in this range.",
  INCONSISTENT_ODOMETER: "The odometer readings in this range are not consistent.",
  NO_BUS_WITH_SUFFICIENT_DATA: "No bus has enough consistent records in this range.",
};

// { ok, value, unit, note }. value is "Insufficient data" unless the backend said "ok".
export function describeEfficiency(efficiency) {
  if (efficiency && efficiency.status === "ok" && Number.isFinite(efficiency.distancePerLiter)) {
    const value = Number(efficiency.distancePerLiter).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    let note = `Distance ${Number(efficiency.distance).toLocaleString()} over ${formatLiters(efficiency.liters)} liters.`;
    if (efficiency.busesIncluded !== undefined) {
      note += ` ${efficiency.busesIncluded} ${efficiency.busesIncluded === 1 ? "bus" : "buses"} included`;
      if (efficiency.busesExcluded > 0) note += `, ${efficiency.busesExcluded} without enough data`;
      note += ".";
    }
    return { ok: true, value, unit: EFFICIENCY_UNIT, note };
  }
  return {
    ok: false,
    value: INSUFFICIENT_DATA,
    unit: "",
    note: EFFICIENCY_REASONS[efficiency?.reason] ?? "The data cannot support a safe estimate.",
  };
}