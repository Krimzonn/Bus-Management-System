import { isCalendarDate } from "../../utils/business-date.js";
import { ARCHIVE_FILTERS, fleetError, parseBusId } from "./validation.js";

export const MIN_SERVICE_DATE = "1900-01-01";
export const MAX_SERVICE_DATE = "9999-12-30";
export const MAX_TYPE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 255; // the audit writer rejects longer strings
export const MAX_ODOMETER = 9999999; // mirrors the database CHECK
export const MAX_SEARCH_LENGTH = 100;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
// NUMERIC(12,2): up to 10 integer digits and 2 decimals.
const COST_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

function hasControlCharacter(text) {
  return /\p{Cc}/u.test(text);
}

function parseText(value, max, code) {
  if (typeof value !== "string" || hasControlCharacter(value)) {
    throw fleetError(code, 400);
  }

  const text = value.trim().replace(/\s+/g, " ");

  if (text.length < 1 || text.length > max) {
    throw fleetError(code, 400);
  }

  return text;
}

function parseDate(value, code) {
  if (!isCalendarDate(value) || value < MIN_SERVICE_DATE || value > MAX_SERVICE_DATE) {
    throw fleetError(code, 400);
  }
  return value;
}

export const parseServiceDate = (value) => parseDate(value, "INVALID_SERVICE_DATE");
export const parseNextServiceDate = (value) =>
  value === undefined || value === null ? null : parseDate(value, "INVALID_NEXT_SERVICE_DATE");
export const parseMaintenanceType = (value) => parseText(value, MAX_TYPE_LENGTH, "INVALID_MAINTENANCE_TYPE");
export const parseWorkDescription = (value) =>
  parseText(value, MAX_DESCRIPTION_LENGTH, "INVALID_WORK_DESCRIPTION");

// Accepts a finite number or a plain decimal string; returns "123.40".
// Negative numbers, exponents, NaN, Infinity and more than 2 decimals are rejected.
export function parseCost(value) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fleetError("INVALID_COST", 400);
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw fleetError("INVALID_COST", 400);
  }
  if (!COST_PATTERN.test(text)) throw fleetError("INVALID_COST", 400);
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

// Optional: undefined and null both mean "not recorded".
export function parseOdometer(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ODOMETER) {
    throw fleetError("INVALID_ODOMETER", 400);
  }
  return value;
}

export function parseMaintenanceId(value) {
  if (typeof value !== "string" || !/^\d{1,18}$/.test(value) || Number(value) < 1) {
    throw fleetError("INVALID_MAINTENANCE_ID", 400);
  }
  return value;
}

export function assertDateOrder(serviceDate, nextServiceDate) {
  if (nextServiceDate !== null && nextServiceDate !== undefined && nextServiceDate < serviceDate) {
    throw fleetError("NEXT_SERVICE_DATE_BEFORE_SERVICE_DATE", 400);
  }
}

function plainObject(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fleetError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw fleetError("INVALID_INPUT", 400);
  }
  return body;
}

const FIELD_PARSERS = Object.freeze({
  serviceDate: parseServiceDate,
  maintenanceType: parseMaintenanceType,
  workDescription: parseWorkDescription,
  cost: parseCost,
  odometer: parseOdometer,
  nextServiceDate: parseNextServiceDate,
});

export function parseCreateInput(body) {
  const input = plainObject(body, ["busId", ...Object.keys(FIELD_PARSERS)]);
  const busId = typeof input.busId === "number" && Number.isSafeInteger(input.busId)
    ? String(input.busId)
    : input.busId;
  const record = { busId: parseBusId(busId) };
  for (const [key, parse] of Object.entries(FIELD_PARSERS)) record[key] = parse(input[key]);
  assertDateOrder(record.serviceDate, record.nextServiceDate);
  return record;
}

// Partial update. The bus of a record cannot be changed. odometer and
// nextServiceDate accept null to clear them.
export function parseUpdateInput(body) {
  const input = plainObject(body, Object.keys(FIELD_PARSERS));
  if (Object.keys(input).length === 0) throw fleetError("INVALID_INPUT", 400);
  const changes = Object.fromEntries(
    Object.keys(input).map((key) => [key, FIELD_PARSERS[key](input[key])]),
  );
  if (changes.serviceDate !== undefined && changes.nextServiceDate !== undefined) {
    assertDateOrder(changes.serviceDate, changes.nextServiceDate);
  }
  return changes;
}

function invalidFilter() {
  return fleetError("INVALID_MAINTENANCE_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw fleetError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw fleetError("INVALID_PAGINATION", 400);
  return n;
}

function parseFilters(query, allowed, defaultArchived) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw invalidFilter();
  }
  const filters = { archived: defaultArchived };

  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw invalidFilter();
    const q = query.q.trim();
    if (q.length > MAX_SEARCH_LENGTH || hasControlCharacter(q)) throw invalidFilter();
    if (q) filters.q = q;
  }
  if (query.archived !== undefined) {
    if (typeof query.archived !== "string" || !ARCHIVE_FILTERS.includes(query.archived)) throw invalidFilter();
    filters.archived = query.archived;
  }
  if (query.busId !== undefined) {
    if (typeof query.busId !== "string" || !/^\d{1,18}$/.test(query.busId) || Number(query.busId) < 1) {
      throw invalidFilter();
    }
    filters.busId = query.busId;
  }
  // Both bounds are inclusive and apply to the service date.
  for (const key of ["serviceFrom", "serviceTo"]) {
    if (query[key] === undefined) continue;
    if (!isCalendarDate(query[key]) || query[key] < MIN_SERVICE_DATE || query[key] > MAX_SERVICE_DATE) {
      throw invalidFilter();
    }
    filters[key] = query[key];
  }
  if (filters.serviceFrom && filters.serviceTo && filters.serviceFrom > filters.serviceTo) {
    throw invalidFilter();
  }
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}

const LIST_KEYS = ["q", "archived", "busId", "serviceFrom", "serviceTo", "page", "limit"];

export const parseListFilters = (query = {}) => parseFilters(query, LIST_KEYS, "false");
// A bus's history is a historical view, so archived records are included by default.
export const parseHistoryFilters = (query = {}) =>
  parseFilters(query, ["q", "archived", "serviceFrom", "serviceTo", "page", "limit"], "all");
// Due lists are always active records only.
export const parseDueFilters = (query = {}) => parseFilters(query, ["busId", "page", "limit"], "false");