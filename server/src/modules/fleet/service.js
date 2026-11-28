import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict } from "../audit/writer.js";
import {
  fleetError,
  parseBusId,
  parseCreateInput,
  parseListFilters,
  parseStatusInput,
  parseUpdateInput,
} from "./validation.js";

const COLUMNS = `id, bus_number, seating_capacity, status, required_license_category,
  is_archived, archived_at, created_at, updated_at, default_route_id, default_driver_id`;
const SELECT_BUS = `SELECT ${COLUMNS} FROM fleet_buses`;
const UPDATABLE = {
  seatingCapacity: "seating_capacity",
  requiredLicenseCategory: "required_license_category",
  defaultRouteId: "default_route_id",
  defaultDriverId: "default_driver_id",
};
const toId = (value) => (value == null ? null : String(value));

function toBus(row) {
  return {
    id: String(row.id),
    busNumber: row.bus_number,
    seatingCapacity: row.seating_capacity,
    status: row.status,
    requiredLicenseCategory: row.required_license_category,
    defaultRouteId: toId(row.default_route_id),
    defaultDriverId: toId(row.default_driver_id),
    isArchived: row.is_archived,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pick(bus, keys) {
  return Object.fromEntries(keys.map((key) => [key, bus[key]]));
}

async function lockBus(client, id) {
  const result = await client.query(`${SELECT_BUS} WHERE id = $1 FOR UPDATE`, [id]);
  if (!result.rows.length) throw fleetError("BUS_NOT_FOUND", 404);
  return toBus(result.rows[0]);
}

function assertNotArchived(bus) {
  if (bus.isArchived) throw fleetError("BUS_ARCHIVED", 409);
}

export async function createBus({ input, actorId, actorEmail }) {
  const bus = parseCreateInput(input);
  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO fleet_buses
           (bus_number, seating_capacity, status, required_license_category,
            default_route_id, default_driver_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [bus.busNumber, bus.seatingCapacity, bus.status, bus.requiredLicenseCategory,
          bus.defaultRouteId ?? null, bus.defaultDriverId ?? null],
      );
      const created = toBus(result.rows[0]);
      await recordStrict(client, {
        actorId, actorEmail, action: "bus.created", entityType: "bus", entityId: created.id,
        before: null,
        after: pick(created, [
          "busNumber", "seatingCapacity", "requiredLicenseCategory", "status", "isArchived",
          "defaultRouteId", "defaultDriverId",
        ]),
      });
      return created;
    });
  } catch (error) {
    if (error.code === "23505") throw fleetError("BUS_ALREADY_EXISTS", 409);
    throw error;
  }
}

export async function getBus(id) {
  const result = await pool.query(`${SELECT_BUS} WHERE id = $1`, [parseBusId(id)]);
  if (!result.rows.length) throw fleetError("BUS_NOT_FOUND", 404);
  return toBus(result.rows[0]);
}

export async function listBuses(query) {
  const filters = parseListFilters(query);
  const clauses = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.archived !== "all") add("is_archived = ?", filters.archived === "true");
  if (filters.status) add("status = ?", filters.status);
  if (filters.requiredLicenseCategory) add("required_license_category = ?", filters.requiredLicenseCategory);
  if (filters.q) {
    // Escape LIKE wildcards so the search term is always literal.
    add("bus_number LIKE ? ESCAPE '\\'", `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
  }

  values.push(filters.limit, (filters.page - 1) * filters.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     FROM fleet_buses ${where}
     ORDER BY bus_number ASC, id ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    items: result.rows.map(toBus),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function updateBus({ id, input, actorId, actorEmail }) {
  const busId = parseBusId(id);
  const changes = parseUpdateInput(input);

  return withTransaction(async (client) => {
    const before = await lockBus(client, busId);
    assertNotArchived(before);
    // Bus numbers are never reused, so they cannot be edited.
    if (changes.busNumber !== undefined && changes.busNumber !== before.busNumber) {
      throw fleetError("BUS_NUMBER_IMMUTABLE", 400);
    }
    const keys = Object.keys(UPDATABLE).filter(
      (key) => changes[key] !== undefined && changes[key] !== before[key],
    );
    if (!keys.length) return before;

    const values = keys.map((key) => changes[key]);
    values.push(busId);
    const result = await client.query(
      `UPDATE fleet_buses
       SET ${keys.map((key, i) => `${UPDATABLE[key]} = $${i + 1}`).join(", ")},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    const after = toBus(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "bus.updated", entityType: "bus", entityId: busId,
      before: pick(before, keys), after: pick(after, keys),
    });
    return after;
  });
}

export async function setBusStatus({ id, input, actorId, actorEmail }) {
  const busId = parseBusId(id);
  const status = parseStatusInput(input);

  return withTransaction(async (client) => {
    const before = await lockBus(client, busId);
    assertNotArchived(before);
    if (before.status === status) return before;
    const result = await client.query(
      `UPDATE fleet_buses SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING ${COLUMNS}`,
      [status, busId],
    );
    const after = toBus(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "bus.status_changed", entityType: "bus", entityId: busId,
      before: { status: before.status }, after: { status: after.status },
    });
    return after;
  });
}

export async function archiveBus({ id, actorId, actorEmail }) {
  const busId = parseBusId(id);

  return withTransaction(async (client) => {
    const before = await lockBus(client, busId);
    if (before.isArchived) throw fleetError("BUS_ALREADY_ARCHIVED", 409);
    const result = await client.query(
      `UPDATE fleet_buses
       SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [busId],
    );
    const after = toBus(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "bus.archived", entityType: "bus", entityId: busId,
      before: { isArchived: false }, after: { isArchived: true },
    });
    return after;
  });
}

// Public read-only eligibility interface for Scheduling (BR-01).
export function evaluateBusEligibility(bus) {
  if (!bus) return { eligible: false, reason: "BUS_NOT_FOUND" };
  if (bus.isArchived) return { eligible: false, reason: "BUS_ARCHIVED" };
  if (bus.status === "inactive") return { eligible: false, reason: "BUS_INACTIVE" };
  if (bus.status === "under_maintenance") return { eligible: false, reason: "BUS_UNDER_MAINTENANCE" };
  return { eligible: true, reason: null, requiredLicenseCategory: bus.requiredLicenseCategory };
}

// `executor` lets Scheduling pass its own transaction client; defaults to the pool.
export async function getBusAssignmentEligibility(id, executor = pool) {
  const result = await executor.query(`${SELECT_BUS} WHERE id = $1`, [parseBusId(id)]);
  return evaluateBusEligibility(result.rows.length ? toBus(result.rows[0]) : null);
}

// Holds a share lock on the bus until the caller's transaction ends, so its
// status or archival cannot change between an eligibility check and the write
// that relies on it. A missing bus locks nothing.
export async function lockBusForAssignment(id, executor) {
  await executor.query("SELECT id FROM fleet_buses WHERE id = $1 FOR SHARE", [parseBusId(id)]);
}

// Stored defaults, not validated: the caller checks eligibility before using one.
export async function getBusScheduleDefaults(id, executor = pool) {
  const result = await executor.query(`${SELECT_BUS} WHERE id = $1`, [parseBusId(id)]);
  if (!result.rows.length) return null;
  const { defaultRouteId, defaultDriverId } = toBus(result.rows[0]);
  return { defaultRouteId, defaultDriverId };
}

// Minimal display data, including archived buses so that history stays readable.
export async function getBusSummaries(ids, executor = pool) {
  if (!ids.length) return [];
  const result = await executor.query(
    "SELECT id, bus_number FROM fleet_buses WHERE id = ANY($1::bigint[])",
    [ids],
  );
  return result.rows.map((row) => ({ id: String(row.id), busNumber: row.bus_number }));
}
