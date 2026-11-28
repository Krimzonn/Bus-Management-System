import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import { recordStrict } from "../audit/writer.js";
import {
  assertDateOrder,
  parseCreateInput,
  parseDueFilters,
  parseHistoryFilters,
  parseListFilters,
  parseMaintenanceId,
  parseUpdateInput,
} from "./maintenance-validation.js";
import { fleetError, parseBusId } from "./validation.js";

// BR-12 / Slice 10: upcoming = today <= next <= today + 30 (inclusive);
// overdue = next < today. Due today is therefore upcoming, never overdue.
export const UPCOMING_WINDOW_DAYS = 30;

const TABLE = "fleet_maintenance_records";
const FROM = `FROM ${TABLE} m JOIN fleet_buses b ON b.id = m.bus_id`;
// Dates are read as text so no time-zone conversion can shift them.
const COLUMNS = `m.id, m.bus_id, b.bus_number, b.is_archived AS bus_is_archived,
  to_char(m.service_date, 'YYYY-MM-DD') AS service_date,
  m.maintenance_type, m.work_description, m.cost, m.odometer,
  to_char(m.next_service_date, 'YYYY-MM-DD') AS next_service_date,
  m.created_by, m.updated_by, m.archived_by, m.archived_at, m.created_at, m.updated_at`;
const UPDATABLE = {
  serviceDate: "service_date",
  maintenanceType: "maintenance_type",
  workDescription: "work_description",
  cost: "cost",
  odometer: "odometer",
  nextServiceDate: "next_service_date",
};
const CREATED_FIELDS = ["busId", ...Object.keys(UPDATABLE), "isArchived"];

const toId = (value) => (value == null ? null : String(value));

export function classifyMaintenanceDue(nextServiceDate, today, isArchived = false) {
  if (isArchived || !nextServiceDate) return "none";
  if (nextServiceDate < today) return "overdue";
  return nextServiceDate <= addDays(today, UPCOMING_WINDOW_DAYS) ? "upcoming" : "none";
}

function toRecord(row, today = businessToday()) {
  const isArchived = row.archived_at != null;
  return {
    id: String(row.id),
    busId: String(row.bus_id),
    busNumber: row.bus_number,
    isBusArchived: row.bus_is_archived,
    serviceDate: row.service_date,
    maintenanceType: row.maintenance_type,
    workDescription: row.work_description,
    cost: row.cost, // exact decimal string, e.g. "150.00"
    odometer: row.odometer,
    nextServiceDate: row.next_service_date,
    dueStatus: classifyMaintenanceDue(row.next_service_date, today, isArchived),
    isArchived,
    archivedAt: row.archived_at ?? null,
    archivedBy: toId(row.archived_by),
    createdBy: toId(row.created_by),
    updatedBy: toId(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pick(record, keys) {
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

async function readRecord(executor, id, { lock = false } = {}) {
  const result = await executor.query(
    `SELECT ${COLUMNS} ${FROM} WHERE m.id = $1${lock ? " FOR UPDATE OF m" : ""}`,
    [id],
  );
  return result.rows.length ? toRecord(result.rows[0]) : null;
}

export async function createMaintenance({ input, actorId, actorEmail }) {
  const data = parseCreateInput(input);

  return withTransaction(async (client) => {
    const bus = await client.query(
      "SELECT id, is_archived FROM fleet_buses WHERE id = $1 FOR SHARE",
      [data.busId],
    );
    if (!bus.rows.length) throw fleetError("BUS_NOT_FOUND", 404);
    if (bus.rows[0].is_archived) throw fleetError("BUS_ARCHIVED", 409);

    const inserted = await client.query(
      `INSERT INTO ${TABLE}
         (bus_id, service_date, maintenance_type, work_description, cost, odometer,
          next_service_date, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [data.busId, data.serviceDate, data.maintenanceType, data.workDescription, data.cost,
        data.odometer, data.nextServiceDate, actorId],
    );
    const record = await readRecord(client, inserted.rows[0].id);
    await recordStrict(client, {
      actorId, actorEmail, action: "maintenance.created", entityType: "maintenance",
      entityId: record.id, before: null, after: pick(record, CREATED_FIELDS),
    });
    return record;
  });
}

export async function updateMaintenance({ id, input, actorId, actorEmail }) {
  const recordId = parseMaintenanceId(id);
  const changes = parseUpdateInput(input);

  return withTransaction(async (client) => {
    const before = await readRecord(client, recordId, { lock: true });
    if (!before) throw fleetError("MAINTENANCE_NOT_FOUND", 404);
    if (before.isArchived) throw fleetError("MAINTENANCE_ARCHIVED", 409);

    const keys = Object.keys(UPDATABLE).filter(
      (key) => changes[key] !== undefined && changes[key] !== before[key],
    );
    if (!keys.length) return before;

    const merged = { ...before, ...changes };
    assertDateOrder(merged.serviceDate, merged.nextServiceDate);

    const values = keys.map((key) => changes[key]);
    values.push(actorId, recordId);
    await client.query(
      `UPDATE ${TABLE}
       SET ${keys.map((key, i) => `${UPDATABLE[key]} = $${i + 1}`).join(", ")},
           updated_by = $${keys.length + 1}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${keys.length + 2}`,
      values,
    );
    const after = await readRecord(client, recordId);
    await recordStrict(client, {
      actorId, actorEmail, action: "maintenance.updated", entityType: "maintenance",
      entityId: recordId, before: pick(before, keys), after: pick(after, keys),
    });
    return after;
  });
}

// Archive, never delete: the row stays and remains readable in history.
export async function archiveMaintenance({ id, actorId, actorEmail }) {
  const recordId = parseMaintenanceId(id);

  return withTransaction(async (client) => {
    const before = await readRecord(client, recordId, { lock: true });
    if (!before) throw fleetError("MAINTENANCE_NOT_FOUND", 404);
    if (before.isArchived) throw fleetError("MAINTENANCE_ALREADY_ARCHIVED", 409);

    await client.query(
      `UPDATE ${TABLE}
       SET archived_at = CURRENT_TIMESTAMP, archived_by = $1, updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [actorId, recordId],
    );
    const after = await readRecord(client, recordId);
    await recordStrict(client, {
      actorId, actorEmail, action: "maintenance.archived", entityType: "maintenance",
      entityId: recordId, before: { isArchived: false }, after: { isArchived: true },
    });
    return after;
  });
}

export async function getMaintenance(id) {
  const record = await readRecord(pool, parseMaintenanceId(id));
  if (!record) throw fleetError("MAINTENANCE_NOT_FOUND", 404);
  return record;
}

const escapeLike = (value) => value.replace(/[\\%_]/g, "\\$&");

function commonClauses(filters, values) {
  const param = (value) => `$${values.push(value)}`;
  const clauses = [];
  if (filters.archived === "false") clauses.push("m.archived_at IS NULL");
  else if (filters.archived === "true") clauses.push("m.archived_at IS NOT NULL");
  if (filters.busId) clauses.push(`m.bus_id = ${param(filters.busId)}`);
  if (filters.serviceFrom) clauses.push(`m.service_date >= ${param(filters.serviceFrom)}::date`);
  if (filters.serviceTo) clauses.push(`m.service_date <= ${param(filters.serviceTo)}::date`);
  if (filters.q) {
    // Escape LIKE wildcards so the search term is always literal.
    const p = param(`%${escapeLike(filters.q)}%`);
    clauses.push(
      `(m.maintenance_type ILIKE ${p} ESCAPE '\\' OR m.work_description ILIKE ${p} ESCAPE '\\')`,
    );
  }
  return clauses;
}

async function queryRecords({ clauses, values, orderBy, filters, today }) {
  const param = (value) => `$${values.push(value)}`;
  const limit = param(filters.limit);
  const offset = param((filters.page - 1) * filters.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     ${FROM} ${where}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    items: result.rows.map((row) => toRecord(row, today)),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

const NEWEST_FIRST = "m.service_date DESC, m.id DESC";

export async function listMaintenance(query) {
  const filters = parseListFilters(query);
  const values = [];
  return queryRecords({
    clauses: commonClauses(filters, values), values, orderBy: NEWEST_FIRST,
    filters, today: businessToday(),
  });
}

// Chronological history of one bus, newest service date first. An archived bus
// stays visible, and archived records are included unless filtered out.
export async function getBusMaintenanceHistory(id, query) {
  const busId = parseBusId(id);
  const filters = parseHistoryFilters(query);
  const bus = await pool.query(
    "SELECT id, bus_number, is_archived FROM fleet_buses WHERE id = $1",
    [busId],
  );
  if (!bus.rows.length) throw fleetError("BUS_NOT_FOUND", 404);

  const values = [busId];
  const page = await queryRecords({
    clauses: ["m.bus_id = $1", ...commonClauses(filters, values)],
    values, orderBy: NEWEST_FIRST, filters, today: businessToday(),
  });
  return {
    bus: { id: String(bus.rows[0].id), busNumber: bus.rows[0].bus_number, isArchived: bus.rows[0].is_archived },
    ...page,
  };
}

async function listDue(kind, query) {
  const filters = parseDueFilters(query);
  const today = businessToday();
  const values = [];
  const param = (value) => `$${values.push(value)}`;
  const clauses = [
    ...commonClauses({ ...filters, archived: "false" }, values),
    "m.next_service_date IS NOT NULL",
  ];
  const through = addDays(today, UPCOMING_WINDOW_DAYS);
  if (kind === "upcoming") {
    clauses.push(`m.next_service_date >= ${param(today)}::date`);
    clauses.push(`m.next_service_date <= ${param(through)}::date`);
  } else {
    clauses.push(`m.next_service_date < ${param(today)}::date`);
  }
  const page = await queryRecords({
    clauses, values, orderBy: "m.next_service_date ASC, m.id ASC", filters, today,
  });
  return {
    kind, asOf: today, ...(kind === "upcoming" ? { upcomingThrough: through } : {}), ...page,
  };
}

export const listUpcomingMaintenance = (query) => listDue("upcoming", query);
export const listOverdueMaintenance = (query) => listDue("overdue", query);