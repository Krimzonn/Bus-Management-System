import { isCalendarDate } from "../../utils/business-date.js";

export const DRIVER_STATUSES = Object.freeze(["available", "on_leave", "absent"]);
export const LICENSE_STATES = Object.freeze(["valid", "expiring_soon", "expired"]);
export const ARCHIVE_FILTERS = Object.freeze(["false", "true", "all"]);
// Characters ignored when comparing license numbers. Mirrors the
// translate(license_number, ' -/', '') unique index in migration 009.
export const LICENSE_SEPARATORS = /[ /-]/g;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
const MAX_NAME_LENGTH = 100;
const MAX_SEARCH_LENGTH = 100;
const MIN_EXPIRY_DATE = "1900-01-01";
const LICENSE_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;
// Fleet's bus categories use this exact format and normalization (migration 007).
// Fleet defines no list of categories, so matching is on the normalized text.
const CATEGORY_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,19}$/;

export function driverError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : null;
}

// Unicode category Cc (C0, DEL and C1), which the database name check also rejects.
function hasControlCharacter(text) {
  return /\p{Cc}/u.test(text);
}

export function parseFullName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
  if (name === null || name.length < 1 || name.length > MAX_NAME_LENGTH || hasControlCharacter(name)) {
    throw driverError("INVALID_DRIVER_NAME", 400);
  }
  return name;
}

export function parseLicenseNumber(value) {
  const number = normalizeToken(value);
  if (number === null || !LICENSE_NUMBER_PATTERN.test(number)) {
    throw driverError("INVALID_LICENSE_NUMBER", 400);
  }
  return number;
}

export function parseLicenseCategory(value) {
  const category = normalizeToken(value);
  if (category === null || !CATEGORY_PATTERN.test(category)) {
    throw driverError("INVALID_LICENSE_CATEGORY", 400);
  }
  return category;
}

function parseDate(value, errorCode) {
  if (!isCalendarDate(value) || value < MIN_EXPIRY_DATE) throw driverError(errorCode, 400);
  return value;
}

// A past date is accepted: expired licenses must be recordable and listed.
export const parseLicenseExpiryDate = (value) => parseDate(value, "INVALID_LICENSE_EXPIRY_DATE");
export const parseTripDate = (value) => parseDate(value, "INVALID_TRIP_DATE");

export function parseStatus(value) {
  if (typeof value !== "string" || !DRIVER_STATUSES.includes(value)) {
    throw driverError("INVALID_DRIVER_STATUS", 400);
  }
  return value;
}

export function parseDriverId(value) {
  if (typeof value !== "string" || !/^\d{1,18}$/.test(value) || Number(value) < 1) {
    throw driverError("INVALID_DRIVER_ID", 400);
  }
  return value;
}

function plainObject(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw driverError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw driverError("INVALID_INPUT", 400);
  }
  return body;
}

const FIELD_PARSERS = Object.freeze({
  fullName: parseFullName,
  licenseNumber: parseLicenseNumber,
  licenseCategory: parseLicenseCategory,
  licenseExpiryDate: parseLicenseExpiryDate,
});

export function parseCreateInput(body) {
  const input = plainObject(body, [...Object.keys(FIELD_PARSERS), "status"]);
  const driver = Object.fromEntries(
    Object.entries(FIELD_PARSERS).map(([key, parse]) => [key, parse(input[key])]),
  );
  driver.status = input.status === undefined ? "available" : parseStatus(input.status);
  return driver;
}

// Status is changed only through its own endpoint.
export function parseUpdateInput(body) {
  const input = plainObject(body, Object.keys(FIELD_PARSERS));
  if (Object.keys(input).length === 0) throw driverError("INVALID_INPUT", 400);
  return Object.fromEntries(
    Object.keys(input).map((key) => [key, FIELD_PARSERS[key](input[key])]),
  );
}

export function parseStatusInput(body) {
  return parseStatus(plainObject(body, ["status"]).status);
}

function invalidFilter() {
  return driverError("INVALID_DRIVER_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw driverError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw driverError("INVALID_PAGINATION", 400);
  return n;
}

function parseChoice(value, choices) {
  if (typeof value !== "string" || !choices.includes(value)) throw invalidFilter();
  return value;
}

export function parseListFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  const filters = { archived: "false" };

  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw invalidFilter();
    const q = query.q.trim();
    // PostgreSQL text cannot hold control characters such as NUL.
    if (q.length > MAX_SEARCH_LENGTH || hasControlCharacter(q)) throw invalidFilter();
    if (q) filters.q = q;
  }
  if (query.status !== undefined) filters.status = parseChoice(query.status, DRIVER_STATUSES);
  if (query.licenseStatus !== undefined) {
    filters.licenseStatus = parseChoice(query.licenseStatus, LICENSE_STATES);
  }
  if (query.licenseCategory !== undefined) {
    const category = normalizeToken(query.licenseCategory);
    if (category === null || !CATEGORY_PATTERN.test(category)) throw invalidFilter();
    filters.licenseCategory = category;
  }
  if (query.archived !== undefined) filters.archived = parseChoice(query.archived, ARCHIVE_FILTERS);
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}

// Expiry monitoring always excludes archived drivers. Callers choose the state
// (default expiring_soon, FR-LIC-02) and paginate; other filters are rejected.
export function parseExpiryFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  for (const key of Object.keys(query)) {
    if (!["state", "page", "limit"].includes(key)) throw invalidFilter();
  }
  return {
    archived: "false",
    licenseStatus: query.state === undefined ? "expiring_soon" : parseChoice(query.state, LICENSE_STATES),
    page: parsePositiveInteger(query.page, 1, MAX_PAGE),
    limit: parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  };
}
