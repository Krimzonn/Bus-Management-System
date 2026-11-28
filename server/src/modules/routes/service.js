import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict } from "../audit/writer.js";
import {
  parseCreateInput,
  parseListFilters,
  parseRouteId,
  parseSelectableFilters,
  parseStatusInput,
  parseUpdateInput,
  routeError,
} from "./validation.js";

const TABLE = "routes_routes";
const COLUMNS = `id, route_code, name, origin, destination, status,
  is_archived, archived_at, created_at, updated_at`;
const SELECT_ROUTE = `SELECT ${COLUMNS} FROM ${TABLE}`;
const UPDATABLE = { name: "name", origin: "origin", destination: "destination" };

function toRoute(row) {
  return {
    id: String(row.id),
    routeCode: row.route_code,
    name: row.name,
    origin: row.origin,
    destination: row.destination,
    status: row.status,
    isArchived: row.is_archived,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pick(route, keys) {
  return Object.fromEntries(keys.map((key) => [key, route[key]]));
}

async function lockRoute(client, id) {
  const result = await client.query(`${SELECT_ROUTE} WHERE id = $1 FOR UPDATE`, [id]);
  if (!result.rows.length) throw routeError("ROUTE_NOT_FOUND", 404);
  return toRoute(result.rows[0]);
}

function assertNotArchived(route) {
  if (route.isArchived) throw routeError("ROUTE_ARCHIVED", 409);
}

export async function createRoute({ input, actorId, actorEmail }) {
  const route = parseCreateInput(input);
  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO ${TABLE} (route_code, name, origin, destination, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [route.routeCode, route.name, route.origin, route.destination, route.status],
      );
      const created = toRoute(result.rows[0]);
      await recordStrict(client, {
        actorId, actorEmail, action: "route.created", entityType: "route", entityId: created.id,
        before: null,
        after: pick(created, ["routeCode", "name", "origin", "destination", "status", "isArchived"]),
      });
      return created;
    });
  } catch (error) {
    if (error.code === "23505") throw routeError("ROUTE_ALREADY_EXISTS", 409);
    throw error;
  }
}

export async function getRoute(id) {
  const result = await pool.query(`${SELECT_ROUTE} WHERE id = $1`, [parseRouteId(id)]);
  if (!result.rows.length) throw routeError("ROUTE_NOT_FOUND", 404);
  return toRoute(result.rows[0]);
}

async function queryRoutes(filters) {
  const clauses = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.archived !== "all") add("is_archived = ?", filters.archived === "true");
  if (filters.status) add("status = ?", filters.status);
  if (filters.q) {
    // Escape LIKE wildcards so the search term is always literal.
    values.push(`%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
    const p = `$${values.length}`;
    clauses.push(
      `(route_code ILIKE ${p} ESCAPE '\\' OR name ILIKE ${p} ESCAPE '\\'` +
      ` OR origin ILIKE ${p} ESCAPE '\\' OR destination ILIKE ${p} ESCAPE '\\')`,
    );
  }

  values.push(filters.limit, (filters.page - 1) * filters.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     FROM ${TABLE} ${where}
     ORDER BY route_code ASC, id ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    items: result.rows.map(toRoute),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function listRoutes(query) {
  return queryRoutes(parseListFilters(query));
}

// Only unblocked, non-archived routes: the routes a new assignment may use.
export async function listSelectableRoutes(query) {
  return queryRoutes(parseSelectableFilters(query));
}

export async function updateRoute({ id, input, actorId, actorEmail }) {
  const routeId = parseRouteId(id);
  const changes = parseUpdateInput(input);

  return withTransaction(async (client) => {
    const before = await lockRoute(client, routeId);
    assertNotArchived(before);
    // Route codes are never reused, so they cannot be edited.
    if (changes.routeCode !== undefined && changes.routeCode !== before.routeCode) {
      throw routeError("ROUTE_CODE_IMMUTABLE", 400);
    }
    const keys = Object.keys(UPDATABLE).filter(
      (key) => changes[key] !== undefined && changes[key] !== before[key],
    );
    if (!keys.length) return before;

    const values = keys.map((key) => changes[key]);
    values.push(routeId);
    const result = await client.query(
      `UPDATE ${TABLE}
       SET ${keys.map((key, i) => `${UPDATABLE[key]} = $${i + 1}`).join(", ")},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    const after = toRoute(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "route.updated", entityType: "route", entityId: routeId,
      before: pick(before, keys), after: pick(after, keys),
    });
    return after;
  });
}

export async function setRouteStatus({ id, input, actorId, actorEmail }) {
  const routeId = parseRouteId(id);
  const status = parseStatusInput(input);

  return withTransaction(async (client) => {
    const before = await lockRoute(client, routeId);
    assertNotArchived(before);
    if (before.status === status) return before;
    const result = await client.query(
      `UPDATE ${TABLE} SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING ${COLUMNS}`,
      [status, routeId],
    );
    const after = toRoute(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "route.status_changed", entityType: "route", entityId: routeId,
      before: { status: before.status }, after: { status: after.status },
    });
    return after;
  });
}

// Archive, never delete: the row and every reference to it are kept.
export async function archiveRoute({ id, actorId, actorEmail }) {
  const routeId = parseRouteId(id);

  return withTransaction(async (client) => {
    const before = await lockRoute(client, routeId);
    if (before.isArchived) throw routeError("ROUTE_ALREADY_ARCHIVED", 409);
    const result = await client.query(
      `UPDATE ${TABLE}
       SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [routeId],
    );
    const after = toRoute(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "route.archived", entityType: "route", entityId: routeId,
      before: { isArchived: false }, after: { isArchived: true },
    });
    return after;
  });
}

// Public read-only eligibility interface for Scheduling (BR-03).
// Fails closed: anything other than an unblocked, non-archived route is ineligible.
export function evaluateRouteEligibility(route) {
  if (!route) return { eligible: false, reason: "ROUTE_NOT_FOUND" };
  if (route.isArchived) return { eligible: false, reason: "ROUTE_ARCHIVED" };
  if (route.status === "blocked") return { eligible: false, reason: "ROUTE_BLOCKED" };
  if (route.status !== "unblocked") return { eligible: false, reason: "ROUTE_UNAVAILABLE" };
  return { eligible: true, reason: null };
}

// `executor` lets Scheduling pass its own transaction client; defaults to the pool.
export async function getRouteAssignmentEligibility(id, executor = pool) {
  const result = await executor.query(`${SELECT_ROUTE} WHERE id = $1`, [parseRouteId(id)]);
  return evaluateRouteEligibility(result.rows.length ? toRoute(result.rows[0]) : null);
}

// Holds a share lock on the route until the caller's transaction ends, so it
// cannot be blocked or archived between an eligibility check and the write.
export async function lockRouteForAssignment(id, executor) {
  await executor.query(`SELECT id FROM ${TABLE} WHERE id = $1 FOR SHARE`, [parseRouteId(id)]);
}

// Minimal display data, including archived routes so that history stays readable.
export async function getRouteSummaries(ids, executor = pool) {
  if (!ids.length) return [];
  const result = await executor.query(
    `SELECT id, route_code, name, origin, destination FROM ${TABLE} WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: String(row.id), routeCode: row.route_code, name: row.name,
    origin: row.origin, destination: row.destination,
  }));
}
