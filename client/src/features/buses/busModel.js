// Constants, validation and formatting for the bus screens. Validation mirrors
// server/src/modules/fleet/validation.js so users get early feedback; the
// backend remains the authority.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const MIN_SEATING_CAPACITY = 1;
export const MAX_SEATING_CAPACITY = 100;

export const BUS_STATUSES = [
  { value: "active", label: "Active", tone: "green" },
  { value: "under_maintenance", label: "Under maintenance", tone: "amber" },
  { value: "inactive", label: "Inactive", tone: "grey" },
];

export const STATUS_BY_VALUE = Object.fromEntries(
  BUS_STATUSES.map((status) => [status.value, status]),
);

export const ARCHIVE_VIEWS = [
  { value: "false", label: "Current buses" },
  { value: "true", label: "Archived buses" },
  { value: "all", label: "All buses" },
];

const BUS_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;
const CATEGORY_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,19}$/;

export function normalizeToken(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toUpperCase()
    : "";
}

export function validateBusNumber(raw) {
  const value = normalizeToken(raw);
  if (!value) return "Enter a bus number.";
  if (!BUS_NUMBER_PATTERN.test(value)) {
    return "Use up to 30 characters: letters, digits, spaces, “/” or “-”, starting with a letter or digit.";
  }
  return "";
}

export function validateSeatingCapacity(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Enter the seating capacity.";
  const number = Number(text);
  if (
    !/^\d+$/.test(text) ||
    number < MIN_SEATING_CAPACITY ||
    number > MAX_SEATING_CAPACITY
  ) {
    return `Enter a whole number from ${MIN_SEATING_CAPACITY} to ${MAX_SEATING_CAPACITY}.`;
  }
  return "";
}

export function validateCategory(raw) {
  const value = normalizeToken(raw);
  if (!value) return "Enter the required license category.";
  if (!CATEGORY_PATTERN.test(value)) {
    return "Use up to 20 characters: letters, digits, spaces or “-”, starting with a letter or digit.";
  }
  return "";
}

// Validates the form. Returns field errors and, when valid, the API payload.
// In edit mode the bus number is not part of the payload (it is immutable).
export function validateBusForm(values, mode) {
  const errors = {};
  if (mode === "create") {
    const problem = validateBusNumber(values.busNumber);
    if (problem) errors.busNumber = problem;
  }
  const capacityProblem = validateSeatingCapacity(values.seatingCapacity);
  if (capacityProblem) errors.seatingCapacity = capacityProblem;
  const categoryProblem = validateCategory(values.requiredLicenseCategory);
  if (categoryProblem) errors.requiredLicenseCategory = categoryProblem;

  if (Object.keys(errors).length > 0) return { errors, input: null };

  const input = {
    seatingCapacity: Number(values.seatingCapacity.trim()),
    requiredLicenseCategory: normalizeToken(values.requiredLicenseCategory),
  };
  if (mode === "create") {
    input.busNumber = normalizeToken(values.busNumber);
    input.status = values.status;
  }
  return { errors, input };
}

// Only the fields that actually differ from the saved bus.
export function diffBus(bus, input) {
  const changes = {};
  if (input.seatingCapacity !== bus.seatingCapacity) {
    changes.seatingCapacity = input.seatingCapacity;
  }
  if (input.requiredLicenseCategory !== bus.requiredLicenseCategory) {
    changes.requiredLicenseCategory = input.requiredLicenseCategory;
  }
  return changes;
}

// Cheap check used to disable "Save" before any validation has run.
export function hasEdits(bus, values) {
  return (
    values.seatingCapacity.trim() !== String(bus.seatingCapacity) ||
    normalizeToken(values.requiredLicenseCategory) !==
      bus.requiredLicenseCategory
  );
}

// Which form field a backend error code belongs to.
export const FIELD_FOR_CODE = {
  INVALID_BUS_NUMBER: "busNumber",
  BUS_ALREADY_EXISTS: "busNumber",
  INVALID_SEATING_CAPACITY: "seatingCapacity",
  INVALID_LICENSE_CATEGORY: "requiredLicenseCategory",
};

// INVALID_INPUT is shared with the login screen, whose text would be wrong here.
export function busErrorMessage(error) {
  if (error instanceof ApiError && error.code === "INVALID_INPUT") {
    return "The bus details were not accepted. Check the values and try again.";
  }
  return errorMessage(error);
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "—";
}