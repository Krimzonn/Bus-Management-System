// Constants, validation and formatting for the driver screens. Validation mirrors
// server/src/modules/drivers/validation.js so users get early feedback; the
// backend remains the authority. License classification (valid / expiring_soon /
// expired) is never calculated here: it always comes from the backend.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const MAX_NAME_LENGTH = 100;

export const DRIVER_STATUSES = [
  { value: "available", label: "Available", tone: "green" },
  { value: "on_leave", label: "On leave", tone: "amber" },
  { value: "absent", label: "Absent", tone: "red" },
];
export const STATUS_BY_VALUE = Object.fromEntries(
  DRIVER_STATUSES.map((status) => [status.value, status]),
);

export const LICENSE_STATES = [
  { value: "valid", label: "Valid", tone: "green" },
  { value: "expiring_soon", label: "Expiring soon", tone: "amber" },
  { value: "expired", label: "Expired", tone: "red" },
];
export const LICENSE_BY_VALUE = Object.fromEntries(
  LICENSE_STATES.map((state) => [state.value, state]),
);

export const ARCHIVE_VIEWS = [
  { value: "false", label: "Active drivers" },
  { value: "true", label: "Archived drivers" },
  { value: "all", label: "All drivers" },
];

const LICENSE_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;
const CATEGORY_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,19}$/;
const MIN_EXPIRY_DATE = "1900-01-01";

export function normalizeToken(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toUpperCase()
    : "";
}

export function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export function validateFullName(raw) {
  const name = normalizeText(raw);
  if (!name) return "Enter the driver’s full name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `The name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  if (/\p{Cc}/u.test(name)) return "The name contains characters that are not allowed.";
  return "";
}

export function validateLicenseNumber(raw) {
  const value = normalizeToken(raw);
  if (!value) return "Enter the license number.";
  if (!LICENSE_NUMBER_PATTERN.test(value)) {
    return "Use up to 30 characters: letters, digits, spaces, “/” or “-”, starting with a letter or digit.";
  }
  return "";
}

export function validateCategory(raw) {
  const value = normalizeToken(raw);
  if (!value) return "Enter the license category.";
  if (!CATEGORY_PATTERN.test(value)) {
    return "Use up to 20 characters: letters, digits, spaces or “-”, starting with a letter or digit.";
  }
  return "";
}

export function validateExpiryDate(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "Enter the license expiry date.";
  if (!isCalendarDate(value) || value < MIN_EXPIRY_DATE) {
    return "Enter a real date (year 1900 or later).";
  }
  return "";
}

// Returns field errors and, when valid, the API payload. Every field is editable.
export function validateDriverForm(values, mode) {
  const errors = {};
  const checks = {
    fullName: validateFullName(values.fullName),
    licenseNumber: validateLicenseNumber(values.licenseNumber),
    licenseCategory: validateCategory(values.licenseCategory),
    licenseExpiryDate: validateExpiryDate(values.licenseExpiryDate),
  };
  for (const [key, problem] of Object.entries(checks)) if (problem) errors[key] = problem;
  if (Object.keys(errors).length > 0) return { errors, input: null };

  const input = {
    fullName: normalizeText(values.fullName),
    licenseNumber: normalizeToken(values.licenseNumber),
    licenseCategory: normalizeToken(values.licenseCategory),
    licenseExpiryDate: values.licenseExpiryDate.trim(),
  };
  if (mode === "create") input.status = values.status;
  return { errors, input };
}

const EDITABLE = ["fullName", "licenseNumber", "licenseCategory", "licenseExpiryDate"];

// Only the fields that actually differ from the saved driver.
export function diffDriver(driver, input) {
  const changes = {};
  for (const key of EDITABLE) if (input[key] !== driver[key]) changes[key] = input[key];
  return changes;
}

// Cheap check used to disable "Save" before any validation has run.
export function hasEdits(driver, values) {
  return (
    normalizeText(values.fullName) !== driver.fullName ||
    normalizeToken(values.licenseNumber) !== driver.licenseNumber ||
    normalizeToken(values.licenseCategory) !== driver.licenseCategory ||
    values.licenseExpiryDate.trim() !== driver.licenseExpiryDate
  );
}

// Which form field a backend error code belongs to.
export const FIELD_FOR_CODE = {
  INVALID_DRIVER_NAME: "fullName",
  INVALID_LICENSE_NUMBER: "licenseNumber",
  DRIVER_LICENSE_ALREADY_EXISTS: "licenseNumber",
  INVALID_LICENSE_CATEGORY: "licenseCategory",
  INVALID_LICENSE_EXPIRY_DATE: "licenseExpiryDate",
};

// INVALID_INPUT is shared with the login screen, whose text would be wrong here.
export function driverErrorMessage(error) {
  if (error instanceof ApiError && error.code === "INVALID_INPUT") {
    return "The driver details were not accepted. Check the values and try again.";
  }
  return errorMessage(error);
}

/* ---- Dates (calendar dates are "YYYY-MM-DD" strings, never instants) ---- */

function toUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Whole calendar days from asOf (the backend's business date) to expiry.
export function daysUntil(expiry, asOf) {
  if (!isCalendarDate(expiry) || !isCalendarDate(asOf)) return null;
  return Math.round((toUtc(expiry) - toUtc(asOf)) / 86400000);
}

const plural = (n) => `${n} ${n === 1 ? "day" : "days"}`;

// Wording only. The classification itself is driver.licenseStatus from the backend.
export function licenseMessage(driver, asOf) {
  const days = daysUntil(driver.licenseExpiryDate, asOf);
  if (driver.licenseStatus === "expired") {
    return days === null ? "License has expired." : `License expired ${plural(-days)} ago.`;
  }
  if (days === null) {
    return driver.licenseStatus === "expiring_soon" ? "License expires soon." : "License is valid.";
  }
  if (days === 0) return "License expires today.";
  if (driver.licenseStatus === "expiring_soon") return `License expires in ${plural(days)}.`;
  return `License is valid. It expires in ${plural(days)}.`;
}

export function daysLabel(expiry, asOf) {
  const days = daysUntil(expiry, asOf);
  if (days === null) return "—";
  if (days < 0) return `${plural(-days)} overdue`;
  if (days === 0) return "Expires today";
  return `${plural(days)} left`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(value) {
  if (!isCalendarDate(value)) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return dateFmt.format(new Date(year, month - 1, day));
}

export function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "—";
}