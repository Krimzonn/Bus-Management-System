// Constants, validation and formatting for the maintenance screens. Validation
// mirrors server/src/modules/fleet/maintenance-validation.js for early feedback
// only: the backend remains the authority. Due status (overdue / upcoming / none)
// is never calculated here; it always comes from the backend's dueStatus.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const HISTORY_PAGE_SIZE = 10;
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "9999-12-30";
export const MAX_TYPE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 255;
export const MAX_ODOMETER = 9999999;
export const MAX_SEARCH_LENGTH = 100;

export const VIEWS = [
  { key: "active", label: "All active" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "archived", label: "Archived" },
];

export const DUE_META = {
  overdue: { label: "Overdue", tone: "red" },
  upcoming: { label: "Upcoming", tone: "amber" },
};

/* ---- Error text. Codes come from the backend; wording lives only here. ---- */

const MAINTENANCE_ERRORS = {
  INVALID_BUS_ID: "Choose a valid bus.",
  BUS_NOT_FOUND: "The selected bus no longer exists. Refresh and choose another.",
  BUS_ARCHIVED:
    "This bus is archived. New maintenance records cannot be added to an archived bus.",
  INVALID_SERVICE_DATE: "Enter a valid service date.",
  INVALID_NEXT_SERVICE_DATE: "Enter a valid next service date.",
  NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE:
    "The next service date cannot be earlier than the service date.",
  INVALID_MAINTENANCE_TYPE: `Enter a maintenance type of up to ${MAX_TYPE_LENGTH} characters.`,
  INVALID_WORK_DESCRIPTION: `Enter a work description of up to ${MAX_DESCRIPTION_LENGTH} characters, on a single line.`,
  INVALID_COST: "Enter a cost of zero or more with at most 2 decimal places.",
  INVALID_ODOMETER: `Enter a whole number from 0 to ${MAX_ODOMETER.toLocaleString("en-US")}.`,
  INVALID_MAINTENANCE_ID: "This maintenance record identifier is not valid.",
  INVALID_MAINTENANCE_FILTER:
    "One of the filters is not valid. Check the values and try again.",
  INVALID_PAGINATION:
    "That page is not available. Go back to the first page and try again.",
  MAINTENANCE_NOT_FOUND: "This maintenance record no longer exists. Refresh the list.",
  MAINTENANCE_ARCHIVED: "This maintenance record is archived and can no longer be changed.",
  MAINTENANCE_ALREADY_ARCHIVED: "This maintenance record is already archived.",
  INVALID_INPUT:
    "The maintenance details were not accepted. Check the values and try again.",
};

export function maintenanceErrorMessage(error) {
  if (error instanceof ApiError && Object.hasOwn(MAINTENANCE_ERRORS, error.code)) {
    return MAINTENANCE_ERRORS[error.code];
  }
  return errorMessage(error);
}

// Errors meaning "your copy of this record is out of date": reload.
export const STALE_CODES = new Set([
  "MAINTENANCE_NOT_FOUND",
  "MAINTENANCE_ARCHIVED",
  "MAINTENANCE_ALREADY_ARCHIVED",
]);

// Which form field a backend error code belongs to.
export const FIELD_FOR_CODE = {
  INVALID_BUS_ID: "busId",
  BUS_NOT_FOUND: "busId",
  BUS_ARCHIVED: "busId",
  INVALID_SERVICE_DATE: "serviceDate",
  INVALID_MAINTENANCE_TYPE: "maintenanceType",
  INVALID_WORK_DESCRIPTION: "workDescription",
  INVALID_COST: "cost",
  INVALID_ODOMETER: "odometer",
  INVALID_NEXT_SERVICE_DATE: "nextServiceDate",
  NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE: "nextServiceDate",
};

/* ---- Normalisation and validation ---- */

export function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hasControlCharacter(text) {
  return /\p{Cc}/u.test(text);
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

const dateInRange = (value) => isCalendarDate(value) && value >= MIN_DATE && value <= MAX_DATE;

// "150.5" -> "150.50". Returns null when the text is not a valid cost.
export function normalizeCost(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

function textProblem(raw, max, emptyMessage, label) {
  const text = normalizeText(raw);
  if (!text) return emptyMessage;
  if (text.length > max) return `${label} must be ${max} characters or fewer.`;
  if (hasControlCharacter(text)) return `${label} contains characters that are not allowed.`;
  return "";
}

export function validateServiceDate(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "Enter the service date.";
  if (!dateInRange(value)) return "Enter a real date (year 1900 or later).";
  return "";
}

export function validateNextServiceDate(raw, serviceDate) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  if (!dateInRange(value)) return "Enter a real date (year 1900 or later).";
  if (dateInRange(serviceDate) && value < serviceDate) {
    return "The next service date cannot be earlier than the service date.";
  }
  return "";
}

export function validateCost(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Enter the cost.";
  if (text.startsWith("-")) return "Cost cannot be negative.";
  if (normalizeCost(text) === null) {
    return "Enter a cost such as 150 or 150.50 (up to 10 digits and 2 decimals).";
  }
  return "";
}

export function validateOdometer(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  if (text.startsWith("-")) return "Odometer cannot be negative.";
  if (!/^\d{1,15}$/.test(text) || Number(text) > MAX_ODOMETER) {
    return `Enter a whole number from 0 to ${MAX_ODOMETER.toLocaleString("en-US")}.`;
  }
  return "";
}

export const EMPTY_FORM = {
  busId: "",
  serviceDate: "",
  maintenanceType: "",
  workDescription: "",
  cost: "",
  odometer: "",
  nextServiceDate: "",
};

export function valuesFromRecord(record) {
  return {
    busId: record.busId,
    serviceDate: record.serviceDate,
    maintenanceType: record.maintenanceType,
    workDescription: record.workDescription,
    cost: record.cost,
    odometer: record.odometer === null || record.odometer === undefined ? "" : String(record.odometer),
    nextServiceDate: record.nextServiceDate ?? "",
  };
}

// Returns field errors and, when valid, a normalised input with every field
// (odometer and nextServiceDate are null when empty).
export function validateMaintenanceForm(values, mode) {
  const errors = {};
  if (mode === "create" && !values.busId) errors.busId = "Choose a bus.";

  const dateProblem = validateServiceDate(values.serviceDate);
  if (dateProblem) errors.serviceDate = dateProblem;

  const typeProblem = textProblem(
    values.maintenanceType, MAX_TYPE_LENGTH, "Enter the maintenance type.", "Maintenance type",
  );
  if (typeProblem) errors.maintenanceType = typeProblem;

  const descriptionProblem = textProblem(
    values.workDescription, MAX_DESCRIPTION_LENGTH, "Describe the work performed.", "Work description",
  );
  if (descriptionProblem) errors.workDescription = descriptionProblem;

  const costProblem = validateCost(values.cost);
  if (costProblem) errors.cost = costProblem;

  const odometerProblem = validateOdometer(values.odometer);
  if (odometerProblem) errors.odometer = odometerProblem;

  const nextProblem = validateNextServiceDate(values.nextServiceDate, values.serviceDate.trim());
  if (nextProblem) errors.nextServiceDate = nextProblem;

  if (Object.keys(errors).length > 0) return { errors, input: null };

  const odometerText = values.odometer.trim();
  const nextText = values.nextServiceDate.trim();
  return {
    errors,
    input: {
      serviceDate: values.serviceDate.trim(),
      maintenanceType: normalizeText(values.maintenanceType),
      workDescription: normalizeText(values.workDescription),
      cost: normalizeCost(values.cost),
      odometer: odometerText === "" ? null : Number(odometerText),
      nextServiceDate: nextText === "" ? null : nextText,
    },
  };
}

// Create payload: optional fields are left out when empty.
export function toCreatePayload(busId, input) {
  const payload = {
    busId,
    serviceDate: input.serviceDate,
    maintenanceType: input.maintenanceType,
    workDescription: input.workDescription,
    cost: input.cost,
  };
  if (input.odometer !== null) payload.odometer = input.odometer;
  if (input.nextServiceDate !== null) payload.nextServiceDate = input.nextServiceDate;
  return payload;
}

const EDITABLE = [
  "serviceDate",
  "maintenanceType",
  "workDescription",
  "cost",
  "odometer",
  "nextServiceDate",
];

// Only the fields that differ from the saved record. null clears an optional field.
export function diffRecord(record, input) {
  const changes = {};
  for (const key of EDITABLE) {
    const saved = record[key] === undefined ? null : record[key];
    if (input[key] !== saved) changes[key] = input[key];
  }
  return changes;
}

// Cheap check used to disable "Save" before any validation has run.
export function hasEdits(record, values) {
  return (
    values.serviceDate.trim() !== record.serviceDate ||
    normalizeText(values.maintenanceType) !== record.maintenanceType ||
    normalizeText(values.workDescription) !== record.workDescription ||
    normalizeCost(values.cost) !== record.cost ||
    values.odometer.trim() !== String(record.odometer ?? "") ||
    values.nextServiceDate.trim() !== (record.nextServiceDate ?? "")
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

// No currency symbol is added: the application has no configured currency.
export function formatCost(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// No unit is added: the application does not define one.
export function formatOdometer(value) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}

// Wording only. The classification itself is record.dueStatus from the backend.
export function dueMessage(record) {
  if (record.isArchived) return "Archived records are not included in the due lists.";
  if (record.dueStatus === "overdue") return "The next service date has passed.";
  if (record.dueStatus === "upcoming") {
    return "Service is due within the next 30 days (due today counts as upcoming).";
  }
  return record.nextServiceDate
    ? "Not due within the next 30 days."
    : "No next service date has been recorded.";
}

export function dueTone(record) {
  if (record.isArchived) return "grey";
  return DUE_META[record.dueStatus]?.tone ?? "grey";
}