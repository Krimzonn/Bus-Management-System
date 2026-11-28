import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { addDays } from "../../utils/business-date.js";
import { recordStrict } from "../audit/writer.js";
import { getDriverIdForAccount, getDriverSummaries } from "../drivers/index.js";
import { getBusSummaries } from "../fleet/index.js";
import { getRouteSummaries } from "../routes/index.js";
import { resolveAssignment } from "./eligibility.js";
import { publishScheduleEvent } from "./notification-seam.js";
import {
  assertDistinctTimes,
  parseCreateInput,
  parseListFilters,
  parseOwnListFilters,
  parseScheduleId,
  parseUpdateInput,
  scheduleError,
} from "./validation.js";

const TABLE = "scheduling_schedules";
// Dates and times are read as text so no time-zone conversion can shift them.
const COLUMNS = `id, to_char(travel_date, 'YYYY-MM-DD') AS travel_date,
  to_char(departure_time, 'HH24:MI') AS departure_time,
  to_char(arrival_time, 'HH24:MI') AS arrival_time,
  bus_id, driver_id, route_id, status,
  started_at, completed_at, cancelled_at, created_at, updated_at`;
const SELECT_SCHEDULE = `SELECT ${COLUMNS} FROM ${TABLE}`;
const TIMING_COLUMNS = {
  travelDate: "travel_date",
  departureTime: "departure_time",
  arrivalTime: "arrival_time",
};
const ASSIGNMENT_COLUMNS = { busId: "bus_id", driverId: "driver_id", routeId: "route_id" };
const UPDATABLE = { ...TIMING_COLUMNS, ...ASSIGNMENT_COLUMNS };
const CREATED_FIELDS = [...Object.keys(UPDATABLE), "status"];
const CONFLICTS = {
  scheduling_schedules_bus_overlap: "SCHEDULE_BUS_CONFLICT",
  scheduling_schedules_driver_overlap: "SCHEDULE_DRIVER_CONFLICT",
};
// The only status changes that exist. Time never changes a status.
const TRANSITIONS = Object.freeze({
  start: { from: "scheduled", to: "in_progress", stamp: "started_at", action: "schedule.started" },
  complete: { from: "in_progress", to: "completed", stamp: "completed_at", action: "schedule.completed" },
  cancel: { from: "scheduled", to: "cancelled", stamp: "cancelled_at", action: "schedule.cancelled" },
});
const MAX_ATTEMPTS = 3;
// deadlock_detected, serialization_failure
const RETRYABLE = new Set(["40P01", "40001"]);

function toSchedule(row) {
  return {
    id: String(row.id),
    travelDate: row.travel_date,
    departureTime: row.departure_time,
    arrivalDate: row.arrival_time < row.departure_time ? addDays(row.travel_date, 1) : row.travel_date,
    arrivalTime: row.arrival_time,
    status: row.status,
    busId: String(row.bus_id),
    driverId: String(row.driver_id),
    routeId: String(row.route_id),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pick(schedule, keys) {
  return Object.fromEntries(keys.map((key) => [key, schedule[key]]));
}

// Adds display summaries through each module's public interface (no joins).
// Queries run one at a time because the executor may be a transaction client.
async function withSummaries(schedules, executor = pool) {
  const ids = (key) => [...new Set(schedules.map((schedule) => schedule[key]))];
  const byId = (items) => new Map(items.map((item) => [item.id, item]));
  const buses = byId(await getBusSummaries(ids("busId"), executor));
  const drivers = byId(await getDriverSummaries(ids("driverId"), executor));
  const routes = byId(await getRouteSummaries(ids("routeId"), executor));
  return schedules.map((schedule) => ({
    ...schedule,
    bus: buses.get(schedule.busId) ?? null,
    driver: drivers.get(schedule.driverId) ?? null,
    route: routes.get(schedule.routeId) ?? null,
  }));
}

const withSummary = async (schedule, executor) => (await withSummaries([schedule], executor))[0];

// One transaction per attempt. Two writers that clash can deadlock inside the
// exclusion check; PostgreSQL aborts one, and its retry then sees the winner.
async function writeSchedule(operation) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withTransaction(operation);
    } catch (error) {
      if (error.code === "23P01" && Object.hasOwn(CONFLICTS, error.constraint)) {
        throw scheduleError(CONFLICTS[error.constraint], 409);
      }
      if (!RETRYABLE.has(error.code)) throw error;
      if (attempt >= MAX_ATTEMPTS) throw scheduleError("SCHEDULE_CONCURRENT_UPDATE", 409);
    }
  }
}

async function lockSchedule(client, id) {
  const result = await client.query(`${SELECT_SCHEDULE} WHERE id = $1 FOR UPDATE`, [id]);
  return result.rows.length ? toSchedule(result.rows[0]) : null;
}

export async function createSchedule({ input, actorId, actorEmail }) {
  const requested = parseCreateInput(input);

  const created = await writeSchedule(async (client) => {
    const assignment = await resolveAssignment(client, requested);
    const result = await client.query(
      `INSERT INTO ${TABLE}
         (travel_date, departure_time, arrival_time, bus_id, driver_id, route_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [requested.travelDate, requested.departureTime, requested.arrivalTime,
        assignment.busId, assignment.driverId, assignment.routeId],
    );
    const schedule = toSchedule(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "schedule.created", entityType: "schedule",
      entityId: schedule.id, before: null, after: pick(schedule, CREATED_FIELDS),
    });
    return withSummary(schedule, client);
  });

  publishScheduleEvent({
    type: "schedule.assigned", scheduleId: created.id,
    driverId: created.driverId, previousDriverId: null,
  });
  return created;
}

// Only a trip that has not started can be edited. Any real change revalidates
// the whole resulting assignment. Timing and assignment changes are audited as
// separate events in the same transaction.
export async function updateSchedule({ id, input, actorId, actorEmail }) {
  const scheduleId = parseScheduleId(id);
  const changes = parseUpdateInput(input);

  const { schedule, previousDriverId, changed } = await writeSchedule(async (client) => {
    const before = await lockSchedule(client, scheduleId);
    if (!before) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
    if (before.status !== "scheduled") throw scheduleError("SCHEDULE_NOT_EDITABLE", 409);

    const keys = Object.keys(UPDATABLE).filter(
      (key) => changes[key] !== undefined && changes[key] !== before[key],
    );
    if (!keys.length) {
      return { schedule: await withSummary(before, client), changed: false };
    }
    const merged = { ...before, ...changes };
    assertDistinctTimes(merged.departureTime, merged.arrivalTime);
    await resolveAssignment(client, merged);

    const values = keys.map((key) => changes[key]);
    values.push(scheduleId);
    const result = await client.query(
      `UPDATE ${TABLE}
       SET ${keys.map((key, i) => `${UPDATABLE[key]} = $${i + 1}`).join(", ")},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    const after = toSchedule(result.rows[0]);
    for (const [action, columns] of [
      ["schedule.updated", TIMING_COLUMNS],
      ["schedule.assignment_changed", ASSIGNMENT_COLUMNS],
    ]) {
      const group = keys.filter((key) => Object.hasOwn(columns, key));
      if (!group.length) continue;
      await recordStrict(client, {
        actorId, actorEmail, action, entityType: "schedule", entityId: scheduleId,
        before: pick(before, group), after: pick(after, group),
      });
    }
    return {
      schedule: await withSummary(after, client),
      previousDriverId: before.driverId === after.driverId ? null : before.driverId,
      changed: true,
    };
  });

  if (changed) {
    publishScheduleEvent({
      type: "schedule.changed", scheduleId, driverId: schedule.driverId, previousDriverId,
    });
  }
  return schedule;
}

// `ownerAccountId` restricts the action to the driver linked to that account.
async function transition({ id, name, ownerAccountId, actorId, actorEmail }) {
  const scheduleId = parseScheduleId(id);
  const { from, to, stamp, action } = TRANSITIONS[name];

  return writeSchedule(async (client) => {
    const before = await lockSchedule(client, scheduleId);
    if (ownerAccountId !== undefined) {
      const driverId = await requireLinkedDriver(ownerAccountId, client);
      // Another driver's trip is reported exactly like a missing one.
      if (before?.driverId !== driverId) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
    }
    if (!before) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
    if (before.status !== from) throw scheduleError("INVALID_SCHEDULE_TRANSITION", 409);

    const result = await client.query(
      `UPDATE ${TABLE}
       SET status = $1, ${stamp} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING ${COLUMNS}`,
      [to, scheduleId],
    );
    const after = toSchedule(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action, entityType: "schedule", entityId: scheduleId,
      before: { status: before.status }, after: { status: after.status },
    });
    return withSummary(after, client);
  });
}

export const startTrip = ({ id, actorId, actorEmail }) =>
  transition({ id, name: "start", actorId, actorEmail });

export const completeTrip = ({ id, actorId, actorEmail }) =>
  transition({ id, name: "complete", actorId, actorEmail });

export async function cancelSchedule({ id, actorId, actorEmail }) {
  const schedule = await transition({ id, name: "cancel", actorId, actorEmail });
  publishScheduleEvent({
    type: "schedule.cancelled", scheduleId: schedule.id,
    driverId: schedule.driverId, previousDriverId: null,
  });
  return schedule;
}

// A driver's own actions: the signed-in account is both the actor and the owner.
export const startOwnTrip = ({ id, actorId, actorEmail }) =>
  transition({ id, name: "start", ownerAccountId: actorId, actorId, actorEmail });

export const completeOwnTrip = ({ id, actorId, actorEmail }) =>
  transition({ id, name: "complete", ownerAccountId: actorId, actorId, actorEmail });

async function requireLinkedDriver(userId, executor) {
  const driverId = await getDriverIdForAccount(userId, executor);
  if (!driverId) throw scheduleError("DRIVER_ACCOUNT_NOT_LINKED", 403);
  return driverId;
}

async function querySchedules(filters) {
  const clauses = [];
  const values = [];
  const param = (value) => `$${values.push(value)}`;

  if (filters.dateFrom) clauses.push(`travel_date >= ${param(filters.dateFrom)}::date`);
  if (filters.dateTo) clauses.push(`travel_date <= ${param(filters.dateTo)}::date`);
  if (filters.status) clauses.push(`status = ${param(filters.status)}`);
  for (const [key, column] of Object.entries(ASSIGNMENT_COLUMNS)) {
    if (filters[key]) clauses.push(`${column} = ${param(filters[key])}`);
  }

  const limit = param(filters.limit);
  const offset = param((filters.page - 1) * filters.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    // Table-qualified so the DATE and TIME columns are sorted, not the text outputs.
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     FROM ${TABLE} ${where}
     ORDER BY ${TABLE}.travel_date ASC, ${TABLE}.departure_time ASC, id ASC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    items: await withSummaries(result.rows.map(toSchedule)),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function listSchedules(query) {
  return querySchedules(parseListFilters(query));
}

export async function getSchedule(id) {
  const result = await pool.query(`${SELECT_SCHEDULE} WHERE id = $1`, [parseScheduleId(id)]);
  if (!result.rows.length) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
  return withSummary(toSchedule(result.rows[0]));
}

export async function listOwnSchedules(userId, query) {
  const filters = parseOwnListFilters(query);
  const driverId = await requireLinkedDriver(userId, pool);
  return querySchedules({ ...filters, driverId });
}

export async function getOwnSchedule(userId, id) {
  const scheduleId = parseScheduleId(id);
  const driverId = await requireLinkedDriver(userId, pool);
  const result = await pool.query(
    `${SELECT_SCHEDULE} WHERE id = $1 AND driver_id = $2`,
    [scheduleId, driverId],
  );
  if (!result.rows.length) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
  return withSummary(toSchedule(result.rows[0]));
}
