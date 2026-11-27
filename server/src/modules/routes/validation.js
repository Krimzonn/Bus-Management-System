export const ROUTE_STATUSES = Object.freeze(["unblocked", "blocked"]);
export const ARCHIVE_FILTERS = Object.freeze(["false", "true", "all"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;
const MAX_TEXT_LENGTH = 100;
const MAX_SEARCH_LENGTH = 100;
const ROUTE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,29}$/;

export function routeError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : null;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
}

function hasControlCharacter(text) {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function parseText(value, errorCode) {
  const text = normalizeText(value);
  if (text === null || text.length < 1 || text.length > MAX_TEXT_LENGTH || hasControlCharacter(text)) {
    throw routeError(errorCode, 400);
  }
  return text;
}

export function parseRouteCode(value) {
  const code = normalizeToken(value);
  if (code === null || !ROUTE_CODE_PATTERN.test(code)) throw routeError("INVALID_ROUTE_CODE", 400);
  return code;
}

export const parseRouteName = (value) => parseText(value, "INVALID_ROUTE_NAME");
export const parseRouteOrigin = (value) => parseText(value, "INVALID_ROUTE_ORIGIN");
export const parseRouteDestination = (value) => parseText(value, "INVALID_ROUTE_DESTINATION");

export function parseStatus(value) {
  if (typeof value !== "string" || !ROUTE_STATUSES.includes(value)) {
    throw routeError("INVALID_ROUTE_STATUS", 400);
  }
  return value;
}

export function parseRouteId(value) {
  if (typeof value !== "string" || !/^\d{1,18}$/.test(value) || Number(value) < 1) {
    throw routeError("INVALID_ROUTE_ID", 400);
  }
  return value;
}

function plainObject(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw routeError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw routeError("INVALID_INPUT", 400);
  }
  return body;
}

export function parseCreateInput(body) {
  const input = plainObject(body, ["routeCode", "name", "origin", "destination", "status"]);
  return {
    routeCode: parseRouteCode(input.routeCode),
    name: parseRouteName(input.name),
    origin: parseRouteOrigin(input.origin),
    destination: parseRouteDestination(input.destination),
    status: input.status === undefined ? "unblocked" : parseStatus(input.status),
  };
}

// Status is changed only through its own endpoint. routeCode is accepted only so
// the service can reject a changed code with ROUTE_CODE_IMMUTABLE.
export function parseUpdateInput(body) {
  const input = plainObject(body, ["routeCode", "name", "origin", "destination"]);
  if (Object.keys(input).length === 0) throw routeError("INVALID_INPUT", 400);
  const changes = {};
  if (input.routeCode !== undefined) changes.routeCode = parseRouteCode(input.routeCode);
  if (input.name !== undefined) changes.name = parseRouteName(input.name);
  if (input.origin !== undefined) changes.origin = parseRouteOrigin(input.origin);
  if (input.destination !== undefined) changes.destination = parseRouteDestination(input.destination);
  return changes;
}

export function parseStatusInput(body) {
  return parseStatus(plainObject(body, ["status"]).status);
}

function invalidFilter() {
  return routeError("INVALID_ROUTE_FILTER", 400);
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw routeError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw routeError("INVALID_PAGINATION", 400);
  return n;
}

export function parseListFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  const filters = { archived: "false" };

  if (query.q !== undefined) {
    if (typeof query.q !== "string") throw invalidFilter();
    const q = query.q.trim();
    if (q.length > MAX_SEARCH_LENGTH) throw invalidFilter();
    if (q) filters.q = q;
  }
  if (query.status !== undefined) {
    if (typeof query.status !== "string" || !ROUTE_STATUSES.includes(query.status)) throw invalidFilter();
    filters.status = query.status;
  }
  if (query.archived !== undefined) {
    if (typeof query.archived !== "string" || !ARCHIVE_FILTERS.includes(query.archived)) throw invalidFilter();
    filters.archived = query.archived;
  }
  filters.page = parsePositiveInteger(query.page, 1, MAX_PAGE);
  filters.limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return filters;
}

// The selectable list is fixed to unblocked, non-archived routes. Callers may
// only search and paginate; status/archived filters are rejected, not ignored.
export function parseSelectableFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw invalidFilter();
  if (query.status !== undefined || query.archived !== undefined) throw invalidFilter();
  return { ...parseListFilters(query), status: "unblocked", archived: "false" };
}