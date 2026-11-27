// Constants, validation and formatting for the route screens. Validation mirrors
// server/src/modules/routes/validation.js so users get early feedback; the
// backend remains the authority.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const MAX_TEXT_LENGTH = 100;

export const ROUTE_STATUSES = [
  { value: "unblocked", label: "Unblocked", tone: "green" },
  { value: "blocked", label: "Blocked", tone: "red" },
];

export const STATUS_BY_VALUE = Object.fromEntries(
  ROUTE_STATUSES.map((status) => [status.value, status]),
);

// "false" = routes that are not archived (blocked routes are included).
export const ARCHIVE_VIEWS = [
  { value: "false", label: "Active routes" },
  { value: "true", label: "Archived routes" },
  { value: "all", label: "All routes" },
];

const ROUTE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;

export function normalizeToken(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toUpperCase()
    : "";
}

export function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hasControlCharacter(text) {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function validateRouteCode(raw) {
  const value = normalizeToken(raw);
  if (!value) return "Enter a route code.";
  if (!ROUTE_CODE_PATTERN.test(value)) {
    return "Use up to 30 characters: letters, digits, spaces, “/” or “-”, starting with a letter or digit.";
  }
  return "";
}

function validateText(raw, emptyMessage, label) {
  const text = normalizeText(raw);
  if (!text) return emptyMessage;
  if (text.length > MAX_TEXT_LENGTH) {
    return `${label} must be ${MAX_TEXT_LENGTH} characters or fewer.`;
  }
  if (hasControlCharacter(text)) return `${label} contains characters that are not allowed.`;
  return "";
}

export const validateRouteName = (raw) => validateText(raw, "Enter a route name.", "Route name");
export const validateOrigin = (raw) => validateText(raw, "Enter the origin.", "Origin");
export const validateDestination = (raw) =>
  validateText(raw, "Enter the destination.", "Destination");

// Validates the form. Returns field errors and, when valid, the API payload.
// In edit mode the route code is not part of the payload (it is immutable).
export function validateRouteForm(values, mode) {
  const errors = {};
  if (mode === "create") {
    const problem = validateRouteCode(values.routeCode);
    if (problem) errors.routeCode = problem;
  }
  const nameProblem = validateRouteName(values.name);
  if (nameProblem) errors.name = nameProblem;
  const originProblem = validateOrigin(values.origin);
  if (originProblem) errors.origin = originProblem;
  const destinationProblem = validateDestination(values.destination);
  if (destinationProblem) errors.destination = destinationProblem;

  if (Object.keys(errors).length > 0) return { errors, input: null };

  const input = {
    name: normalizeText(values.name),
    origin: normalizeText(values.origin),
    destination: normalizeText(values.destination),
  };
  if (mode === "create") input.routeCode = normalizeToken(values.routeCode);
  return { errors, input };
}

// Only the fields that actually differ from the saved route.
export function diffRoute(route, input) {
  const changes = {};
  for (const key of ["name", "origin", "destination"]) {
    if (input[key] !== route[key]) changes[key] = input[key];
  }
  return changes;
}

// Cheap check used to disable "Save" before any validation has run.
export function hasEdits(route, values) {
  return (
    normalizeText(values.name) !== route.name ||
    normalizeText(values.origin) !== route.origin ||
    normalizeText(values.destination) !== route.destination
  );
}

// Which form field a backend error code belongs to.
export const FIELD_FOR_CODE = {
  INVALID_ROUTE_CODE: "routeCode",
  ROUTE_ALREADY_EXISTS: "routeCode",
  INVALID_ROUTE_NAME: "name",
  INVALID_ROUTE_ORIGIN: "origin",
  INVALID_ROUTE_DESTINATION: "destination",
};

// INVALID_INPUT is shared with the login screen, whose text would be wrong here.
export function routeErrorMessage(error) {
  if (error instanceof ApiError && error.code === "INVALID_INPUT") {
    return "The route details were not accepted. Check the values and try again.";
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