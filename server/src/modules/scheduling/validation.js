import { isCalendarDate } from "../../utils/business-date.js";

export const SCHEDULE_STATUSES = Object.freeze(["scheduled", "in_progress", "completed", "cancelled"]);
export const MIN_TRAVEL_DATE = "1900-01-01";
// One day short of the last four-digit date, so an overnight arrival still fits.
export const MAX_TRAVEL_DATE = "9999-12-30";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_FIELDS = Object.freeze([
  "travelDate", "departureTime", "arrivalTime", "busId", "driverId", "routeId",
]);
const OWN_FILTERS = Object.freeze(["dateFrom", "dateTo", "status", "page", "limit"]);
const ALL_FILTERS = Object.freeze([...OWN_FILTERS, "busId", "driverId", "routeId"]);

export function scheduleError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function isTravelDate(value) {
  return isCalendarDate(value) && value >= MIN_TRAVEL_DATE && value <= MAX_TRAVEL_DATE;
}

export function parseTravelDate(value) {
  if (!isTravelDate(value)) throw scheduleError("INVALID_TRAVEL_DATE", 400);
  return value;
}

// 24-hour "HH:MM" in the business time zone.
function parseTime(value, errorCode) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) throw scheduleError(errorCode, 400);
  return value;
}

export const parseDepartureTime = (value) => parseTime(value, "INVALID_DEPARTURE_TIME");
export const parseArrivalTime = (value) => parseTime(value, "INVALID_ARRIVAL_TIME");

// An earlier arrival means the next day, so only equal times are impossible.
export function assertDistinctTimes(departureTime, arrivalTime) {
  if (departureTime === arrivalTime) throw scheduleError("INVALID_TRIP_TIMES", 400);
}

// Returns the canonical id string, or null when the value is not a positive id.
function toId(value) {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text) || BigInt(text) < 1n) return null;
  return String(BigInt(text));
}

function parseId(value, errorCode) {
  const id = toId(value);
  if (id === null) throw scheduleError(errorCode, 400);
  return id;
}

export const parseScheduleId = (value) => parseId(value, "INVALID_SCHEDULE_ID");

const FIELD_PARSERS = Object.freeze({
  travelDate: parseTravelDate,
  departureTime: parseDepartureTime,
  arrivalTime: parseArrivalTime,
  busId: (value) => parseId(value, "INVALID_BUS_ID"),
  driverId: (value) => parseId(value, "INVALID_DRIVER_ID"),
  routeId: (value) => parseId(value, "INVALID_ROUTE_ID"),
});

// Status is never accepted: it changes only through the action endpoints.
function plainObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw scheduleError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!SCHEDULE_FIELDS.includes(key)) throw scheduleError("INVALID_INPUT", 400);
  }
  return body;
}

// driverId and routeId may be omitted (or null) to take the bus defaults.
export function parseCreateInput(body) {
  const input = plainObject(body);
  const schedule = {};
  for (const key of ["travelDate", "departureTime", "arrivalTime", "busId"]) {
    schedule[key] = FIELD_PARSERS[key](input[key]);
  }
  for (const key of ["driverId", "routeId"]) {
    schedule[key] = input[key] === undefined || input[key] === null ? null : FIELD_PARSERS[key](input[key]);
  }
  assertDistinctTimes(schedule.departureTime, schedule.arrivalTime);
  return schedule;
}

// A partial update. Defaults are never re-applied, so null is not accepted.
export function parseUpdateInput(body) {
  const input = plainObject(body);
  if (Object.keys(input).length === 0) throw scheduleError("INVALID_INPUT", 400);
  return Object.fromEntries(
    Object.keys(input).map((key) => [key, FIELD_PARSERS[key](input[key])]),
  );
}

function invalidFilter() {
  return scheduleError("INVALID_SCHEDULE_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw scheduleError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw scheduleError("INVALID_PAGINATION", 400);
  return n;
}

function parseFilters(query, allowed) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  // Unknown filters are rejected so that a driver cannot widen their own list.
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw invalidFilter();
  }
  const filters = {};
  // Both bounds are inclusive and apply to the travel (departure) date.
  for (const key of ["dateFrom", "dateTo"]) {
    if (query[key] === undefined) continue;
    if (!isTravelDate(query[key])) throw invalidFilter();
    filters[key] = query[key];
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw invalidFilter();
  if (query.status !== undefined) {
    if (typeof query.status !== "string" || !SCHEDULE_STATUSES.includes(query.status)) throw invalidFilter();
    filters.status = query.status;
  }
  for (const key of ["busId", "driverId", "routeId"]) {
    if (query[key] === undefined) continue;
    const id = toId(query[key]);
    if (id === null) throw invalidFilter();
    filters[key] = id;
  }
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}

export const parseListFilters = (query = {}) => parseFilters(query, ALL_FILTERS);
export const parseOwnListFilters = (query = {}) => parseFilters(query, OWN_FILTERS);
