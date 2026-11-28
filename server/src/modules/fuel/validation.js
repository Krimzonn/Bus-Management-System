import { isCalendarDate } from "../../utils/business-date.js";

export const ARCHIVE_FILTERS = Object.freeze(["false", "true", "all"]);
export const SUMMARY_ARCHIVE_FILTERS = Object.freeze(["false", "all"]);
export const MIN_PURCHASE_DATE = "1900-01-01";
export const MAX_PURCHASE_DATE = "9999-12-30";
export const MAX_ODOMETER = 9999999; // mirrors the database CHECK

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
// NUMERIC(10,2) and NUMERIC(12,2): at most 8 / 10 integer digits and 2 decimals.
const LITERS_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const COST_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function fuelError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

// Returns the canonical id string, or null when the value is not a positive id.
function toId(value) {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text) || BigInt(text) < 1n) return null;
  return String(BigInt(text));
}

export function parseBusId(value) {
  const id = toId(value);
  if (id === null) throw fuelError("INVALID_BUS_ID", 400);
  return id;
}

export function parseFuelId(value) {
  const id = toId(value);
  if (id === null) throw fuelError("INVALID_FUEL_ID", 400);
  return id;
}

export function parsePurchaseDate(value) {
  if (!isCalendarDate(value) || value < MIN_PURCHASE_DATE || value > MAX_PURCHASE_DATE) {
    throw fuelError("INVALID_PURCHASE_DATE", 400);
  }
  return value;
}

// Accepts a finite number or a plain decimal string. NaN, Infinity, exponents,
// signs, more than two decimals and over-long values are rejected.
function decimalText(value, pattern, code) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fuelError(code, 400);
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw fuelError(code, 400);
  }
  if (!pattern.test(text)) throw fuelError(code, 400);
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

export function parseLiters(value) {
  const liters = decimalText(value, LITERS_PATTERN, "INVALID_LITERS");
  if (liters === "0.00") throw fuelError("INVALID_LITERS", 400); // must be > 0
  return liters;
}

export const parseTotalCost = (value) => decimalText(value, COST_PATTERN, "INVALID_TOTAL_COST");

export function parseOdometer(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ODOMETER) {
    throw fuelError("INVALID_ODOMETER", 400);
  }
  return value;
}

function plainObject(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fuelError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw fuelError("INVALID_INPUT", 400);
  }
  return body;
}

const FIELD_PARSERS = Object.freeze({
  purchaseDate: parsePurchaseDate,
  liters: parseLiters,
  totalCost: parseTotalCost,
  odometer: parseOdometer,
});

// Every field is required on create.
export function parseCreateInput(body) {
  const input = plainObject(body, ["busId", ...Object.keys(FIELD_PARSERS)]);
  const record = { busId: parseBusId(input.busId) };
  for (const [key, parse] of Object.entries(FIELD_PARSERS)) record[key] = parse(input[key]);
  return record;
}

// Partial update. The bus of a record cannot be changed.
export function parseUpdateInput(body) {
  const input = plainObject(body, Object.keys(FIELD_PARSERS));
  if (Object.keys(input).length === 0) throw fuelError("INVALID_INPUT", 400);
  return Object.fromEntries(
    Object.keys(input).map((key) => [key, FIELD_PARSERS[key](input[key])]),
  );
}

function invalidFilter() {
  return fuelError("INVALID_FUEL_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw fuelError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw fuelError("INVALID_PAGINATION", 400);
  return n;
}

function filterDate(value) {
  if (!isCalendarDate(value) || value < MIN_PURCHASE_DATE || value > MAX_PURCHASE_DATE) {
    throw invalidFilter();
  }
  return value;
}

function filterBusId(value) {
  const id = typeof value === "string" ? toId(value) : null;
  if (id === null) throw invalidFilter();
  return id;
}

function parseFilters(query, allowed, defaultArchived) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw invalidFilter();
  }
  const filters = { archived: defaultArchived };
  if (query.archived !== undefined) {
    if (typeof query.archived !== "string" || !ARCHIVE_FILTERS.includes(query.archived)) throw invalidFilter();
    filters.archived = query.archived;
  }
  if (query.busId !== undefined) filters.busId = filterBusId(query.busId);
  // Both bounds are inclusive and apply to the purchase date.
  if (query.purchaseFrom !== undefined) filters.purchaseFrom = filterDate(query.purchaseFrom);
  if (query.purchaseTo !== undefined) filters.purchaseTo = filterDate(query.purchaseTo);
  if (filters.purchaseFrom && filters.purchaseTo && filters.purchaseFrom > filters.purchaseTo) {
    throw fuelError("INVALID_DATE_RANGE", 400);
  }
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}

export const parseListFilters = (query = {}) =>
  parseFilters(query, ["archived", "busId", "purchaseFrom", "purchaseTo", "page", "limit"], "false");

// A bus's history is a historical view, so archived records are included by default.
export const parseHistoryFilters = (query = {}) =>
  parseFilters(query, ["archived", "purchaseFrom", "purchaseTo", "page", "limit"], "all");

// Summary: startDate and endDate are required and inclusive. Archived records are
// excluded unless archived=all is requested explicitly.
export function parseSummaryFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  for (const key of Object.keys(query)) {
    if (!["busId", "startDate", "endDate", "archived"].includes(key)) throw invalidFilter();
  }
  if (query.startDate === undefined || query.endDate === undefined) throw invalidFilter();
  const startDate = filterDate(query.startDate);
  const endDate = filterDate(query.endDate);
  if (startDate > endDate) throw fuelError("INVALID_DATE_RANGE", 400);
  const filters = { startDate, endDate, archived: "false" };
  if (query.archived !== undefined) {
    if (typeof query.archived !== "string" || !SUMMARY_ARCHIVE_FILTERS.includes(query.archived)) {
      throw invalidFilter();
    }
    filters.archived = query.archived;
  }
  if (query.busId !== undefined) filters.busId = filterBusId(query.busId);
  return filters;
}