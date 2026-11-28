export const BUS_STATUSES = Object.freeze(["active", "inactive", "under_maintenance"]);
export const MIN_SEATING_CAPACITY = 1;
export const MAX_SEATING_CAPACITY = 100; // assumption; mirrored by a DB CHECK
export const ARCHIVE_FILTERS = Object.freeze(["false", "true", "all"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
const BUS_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;
const CATEGORY_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,19}$/;

export function fleetError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : null;
}

export function parseBusNumber(value) {
  const n = normalizeToken(value);
  if (n === null || !BUS_NUMBER_PATTERN.test(n)) throw fleetError("INVALID_BUS_NUMBER", 400);
  return n;
}

export function parseSeatingCapacity(value) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_SEATING_CAPACITY ||
    value > MAX_SEATING_CAPACITY
  ) throw fleetError("INVALID_SEATING_CAPACITY", 400);
  return value;
}

export function parseLicenseCategory(value) {
  const n = normalizeToken(value);
  if (n === null || !CATEGORY_PATTERN.test(n)) throw fleetError("INVALID_LICENSE_CATEGORY", 400);
  return n;
}

export function parseStatus(value) {
  if (typeof value !== "string" || !BUS_STATUSES.includes(value)) {
    throw fleetError("INVALID_BUS_STATUS", 400);
  }
  return value;
}

export function parseBusId(value) {
  if (typeof value !== "string" || !/^\d{1,18}$/.test(value) || Number(value) < 1) {
    throw fleetError("INVALID_BUS_ID", 400);
  }
  return value;
}

// A default route or driver is only a stored id here: Fleet does not depend on
// Routes or Drivers, so Scheduling validates it when it is used. null clears it.
export function parseDefaultId(value, errorCode) {
  if (value === null) return null;
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text) || BigInt(text) < 1n) {
    throw fleetError(errorCode, 400);
  }
  return String(BigInt(text));
}

const DEFAULT_ID_ERRORS = Object.freeze({
  defaultRouteId: "INVALID_DEFAULT_ROUTE_ID",
  defaultDriverId: "INVALID_DEFAULT_DRIVER_ID",
});

// Only the defaults that were sent are returned.
function parseDefaults(input) {
  const defaults = {};
  for (const [key, errorCode] of Object.entries(DEFAULT_ID_ERRORS)) {
    if (input[key] !== undefined) defaults[key] = parseDefaultId(input[key], errorCode);
  }
  return defaults;
}

function plainObject(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fleetError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw fleetError("INVALID_INPUT", 400);
  }
  return body;
}

export function parseCreateInput(body) {
  const input = plainObject(body, [
    "busNumber", "seatingCapacity", "status", "requiredLicenseCategory",
    ...Object.keys(DEFAULT_ID_ERRORS),
  ]);
  return {
    busNumber: parseBusNumber(input.busNumber),
    seatingCapacity: parseSeatingCapacity(input.seatingCapacity),
    requiredLicenseCategory: parseLicenseCategory(input.requiredLicenseCategory),
    status: input.status === undefined ? "active" : parseStatus(input.status),
    ...parseDefaults(input),
  };
}

// Status is changed only through its own endpoint.
export function parseUpdateInput(body) {
  const input = plainObject(body, [
    "busNumber", "seatingCapacity", "requiredLicenseCategory", ...Object.keys(DEFAULT_ID_ERRORS),
  ]);
  if (Object.keys(input).length === 0) throw fleetError("INVALID_INPUT", 400);
  const changes = parseDefaults(input);
  if (input.busNumber !== undefined) changes.busNumber = parseBusNumber(input.busNumber);
  if (input.seatingCapacity !== undefined) changes.seatingCapacity = parseSeatingCapacity(input.seatingCapacity);
  if (input.requiredLicenseCategory !== undefined) {
    changes.requiredLicenseCategory = parseLicenseCategory(input.requiredLicenseCategory);
  }
  return changes;
}

export function parseStatusInput(body) {
  return parseStatus(plainObject(body, ["status"]).status);
}

function invalidFilter() {
  return fleetError("INVALID_BUS_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw fleetError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw fleetError("INVALID_PAGINATION", 400);
  return n;
}

export function parseListFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  const filters = { archived: "false" };

  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw invalidFilter();
    const q = query.q.trim();
    if (q.length > 30) throw invalidFilter();
    if (q) filters.q = q.toUpperCase();
  }
  if (query.status !== undefined) {
    if (typeof query.status !== "string" || !BUS_STATUSES.includes(query.status)) throw invalidFilter();
    filters.status = query.status;
  }
  if (query.requiredLicenseCategory !== undefined) {
    const c = normalizeToken(query.requiredLicenseCategory);
    if (c === null || !CATEGORY_PATTERN.test(c)) throw invalidFilter();
    filters.requiredLicenseCategory = c;
  }
  if (query.archived !== undefined) {
    if (typeof query.archived !== "string" || !ARCHIVE_FILTERS.includes(query.archived)) throw invalidFilter();
    filters.archived = query.archived;
  }
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}