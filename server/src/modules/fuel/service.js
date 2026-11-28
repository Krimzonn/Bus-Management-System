import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict } from "../audit/writer.js";
import { getBusRecordStates, lockBusForAssignment } from "../fleet/index.js";
import {
  combineEfficiency,
  estimateFuelEfficiency,
  formatHundredths,
  toHundredths,
} from "./efficiency.js";
import {
  fuelError,
  parseBusId,
  parseCreateInput,
  parseFuelId,
  parseHistoryFilters,
  parseListFilters,
  parseSummaryFilters,
  parseUpdateInput,
} from "./validation.js";

const TABLE = "fuel_purchases";
// The date is read as text so no time-zone conversion can shift it. Every query
// aliases the table as "f" and orders by f.purchase_date (the DATE column), never by
// the text output column of the same name.
const COLUMNS = `f.id, f.bus_id, to_char(f.purchase_date, 'YYYY-MM-DD') AS purchase_date,
  f.liters, f.total_cost, f.odometer, f.created_by, f.updated_by, f.archived_by,
  f.archived_at, f.created_at, f.updated_at`;
const FROM = `FROM ${TABLE} f`;
const UPDATABLE = {
  purchaseDate: "purchase_date",
  liters: "liters",
  totalCost: "total_cost",
  odometer: "odometer",
};
const CREATED_FIELDS = ["busId", ...Object.keys(UPDATABLE), "isArchived"];
const SEQUENCE_CONSTRAINT = "fuel_purchases_odometer_sequence";

// List: newest first. History of one bus: oldest first (chronological). Same-date
// readings are ordered by odometer, then id, so the order is always deterministic.
const NEWEST_FIRST = "f.purchase_date DESC, f.odometer DESC, f.id DESC";
const OLDEST_FIRST = "f.purchase_date ASC, f.odometer ASC, f.id ASC";

const toId = (value) => (value == null ? null : String(value));

function toRecord(row) {
  const isArchived = row.archived_at != null;
  return {
    id: String(row.id),
    busId: String(row.bus_id),
    purchaseDate: row.purchase_date,
    liters: row.liters, // exact decimal strings, e.g. "40.50"
    totalCost: row.total_cost,
    odometer: row.odometer,
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

// Display data comes from Fleet's public interface (no join); archived buses stay visible.
async function withBuses(records, executor = pool) {
  const ids = [...new Set(records.map((record) => record.busId))];
  const buses = new Map((await getBusRecordStates(ids, executor)).map((bus) => [bus.id, bus]));
  return records.map((record) => ({
    ...record,
    busNumber: buses.get(record.busId)?.busNumber ?? null,
    isBusArchived: buses.get(record.busId)?.isArchived ?? null,
  }));
}

async function readRecord(executor, id, { lock = false } = {}) {
  const result = await executor.query(
    `SELECT ${COLUMNS} ${FROM} WHERE f.id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!result.rows.length) return null;
  return (await withBuses([toRecord(result.rows[0])], executor))[0];
}

// Serialises fuel writes of one bus until the transaction ends. The migration's
// trigger takes the same key, so a direct SQL write is serialised too.
async function lockBusSequence(client, busId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
    `fuel:bus:${busId}`,
  ]);
}

// Active readings of the bus must not decrease across purchase dates. Same-date
// readings are not ordered against each other. Archived records are not part of the
// active sequence (they are kept for history and can never be restored).
async function assertOdometerSequence(client, { busId, purchaseDate, odometer, excludeId = null }) {
  const result = await client.query(
    `SELECT MAX(odometer) FILTER (WHERE purchase_date < $2::date) AS previous_max,
            MIN(odometer) FILTER (WHERE purchase_date > $2::date) AS next_min
     FROM ${TABLE}
     WHERE bus_id = $1 AND archived_at IS NULL AND ($3::bigint IS NULL OR id <> $3::bigint)`,
    [busId, purchaseDate, excludeId],
  );
  const { previous_max: previous = null, next_min: next = null } = result.rows[0] ?? {};
  if (previous !== null && odometer < previous) throw fuelError("ODOMETER_BELOW_PREVIOUS", 409);
  if (next !== null && odometer > next) throw fuelError("ODOMETER_ABOVE_NEXT", 409);
}

function mapWriteError(error) {
  if (error.code === "23514" && error.constraint === SEQUENCE_CONSTRAINT) {
    return fuelError("ODOMETER_SEQUENCE_VIOLATION", 409);
  }
  return error;
}

export async function createFuelRecord({ input, actorId, actorEmail }) {
  const data = parseCreateInput(input);

  try {
    return await withTransaction(async (client) => {
      await lockBusSequence(client, data.busId);
      await lockBusForAssignment(data.busId, client); // the bus cannot be archived mid-write
      const [bus] = await getBusRecordStates([data.busId], client);
      if (!bus) throw fuelError("BUS_NOT_FOUND", 404);
      if (bus.isArchived) throw fuelError("BUS_ARCHIVED", 409);
      await assertOdometerSequence(client, data);

      const inserted = await client.query(
        `INSERT INTO ${TABLE}
           (bus_id, purchase_date, liters, total_cost, odometer, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [data.busId, data.purchaseDate, data.liters, data.totalCost, data.odometer, actorId],
      );
      const record = await readRecord(client, inserted.rows[0].id);
      await recordStrict(client, {
        actorId, actorEmail, action: "fuel.created", entityType: "fuel",
        entityId: record.id, before: null, after: pick(record, CREATED_FIELDS),
      });
      return record;
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function updateFuelRecord({ id, input, actorId, actorEmail }) {
  const recordId = parseFuelId(id);
  const changes = parseUpdateInput(input);

  try {
    return await withTransaction(async (client) => {
      const before = await readRecord(client, recordId, { lock: true });
      if (!before) throw fuelError("FUEL_RECORD_NOT_FOUND", 404);
      if (before.isArchived) throw fuelError("FUEL_RECORD_ARCHIVED", 409);

      const keys = Object.keys(UPDATABLE).filter(
        (key) => changes[key] !== undefined && changes[key] !== before[key],
      );
      if (!keys.length) return before;

      await lockBusSequence(client, before.busId);
      // Editing may never bypass the rule: the edited reading is checked against the
      // neighbours before and after it, excluding the record itself.
      if (keys.includes("purchaseDate") || keys.includes("odometer")) {
        const merged = { ...before, ...changes };
        await assertOdometerSequence(client, {
          busId: before.busId,
          purchaseDate: merged.purchaseDate,
          odometer: merged.odometer,
          excludeId: recordId,
        });
      }

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
        actorId, actorEmail, action: "fuel.updated", entityType: "fuel",
        entityId: recordId, before: pick(before, keys), after: pick(after, keys),
      });
      return after;
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

// Archive, never delete: the row stays and remains readable in history.
export async function archiveFuelRecord({ id, actorId, actorEmail }) {
  const recordId = parseFuelId(id);

  return withTransaction(async (client) => {
    const before = await readRecord(client, recordId, { lock: true });
    if (!before) throw fuelError("FUEL_RECORD_NOT_FOUND", 404);
    if (before.isArchived) throw fuelError("FUEL_RECORD_ALREADY_ARCHIVED", 409);

    await client.query(
      `UPDATE ${TABLE}
       SET archived_at = CURRENT_TIMESTAMP, archived_by = $1, updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [actorId, recordId],
    );
    const after = await readRecord(client, recordId);
    await recordStrict(client, {
      actorId, actorEmail, action: "fuel.archived", entityType: "fuel",
      entityId: recordId, before: { isArchived: false }, after: { isArchived: true },
    });
    return after;
  });
}

export async function getFuelRecord(id) {
  const record = await readRecord(pool, parseFuelId(id));
  if (!record) throw fuelError("FUEL_RECORD_NOT_FOUND", 404);
  return record;
}

function filterClauses(filters, values) {
  const param = (value) => `$${values.push(value)}`;
  const clauses = [];
  if (filters.archived === "false") clauses.push("f.archived_at IS NULL");
  else if (filters.archived === "true") clauses.push("f.archived_at IS NOT NULL");
  if (filters.busId) clauses.push(`f.bus_id = ${param(filters.busId)}`);
  if (filters.purchaseFrom) clauses.push(`f.purchase_date >= ${param(filters.purchaseFrom)}::date`);
  if (filters.purchaseTo) clauses.push(`f.purchase_date <= ${param(filters.purchaseTo)}::date`);
  return clauses;
}

async function queryRecords({ clauses, values, orderBy, filters }) {
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
    items: await withBuses(result.rows.map(toRecord)),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function listFuelRecords(query) {
  const filters = parseListFilters(query);
  const values = [];
  return queryRecords({ clauses: filterClauses(filters, values), values, orderBy: NEWEST_FIRST, filters });
}

// Chronological history of one bus (oldest first). Archived records are included
// unless filtered out, and an archived bus keeps its history.
export async function getBusFuelHistory(id, query) {
  const busId = parseBusId(id);
  const filters = parseHistoryFilters(query);
  const [bus] = await getBusRecordStates([busId]);
  if (!bus) throw fuelError("BUS_NOT_FOUND", 404);

  const values = [busId];
  const page = await queryRecords({
    clauses: ["f.bus_id = $1", ...filterClauses(filters, values)],
    values, orderBy: OLDEST_FIRST, filters,
  });
  return { bus: { id: bus.id, busNumber: bus.busNumber, isArchived: bus.isArchived }, ...page };
}

// Fuel summary for an inclusive date range. One query gives a consistent snapshot;
// totals are summed in whole hundredths and efficiency comes from efficiency.js.
export async function getFuelSummary(query) {
  const filters = parseSummaryFilters(query);
  if (filters.busId) {
    const [bus] = await getBusRecordStates([filters.busId]);
    if (!bus) throw fuelError("BUS_NOT_FOUND", 404);
  }

  const values = [];
  const clauses = filterClauses(
    {
      archived: filters.archived, busId: filters.busId,
      purchaseFrom: filters.startDate, purchaseTo: filters.endDate,
    },
    values,
  );
  const result = await pool.query(
    `SELECT f.bus_id, f.liters, f.total_cost, f.odometer
     ${FROM} WHERE ${clauses.join(" AND ")}
     ORDER BY f.bus_id, f.purchase_date, f.odometer, f.id`,
    values,
  );

  const perBus = new Map();
  for (const row of result.rows) {
    const key = String(row.bus_id);
    if (!perBus.has(key)) perBus.set(key, { odometers: [], liters: 0, cost: 0 });
    const entry = perBus.get(key);
    entry.odometers.push(row.odometer);
    entry.liters += toHundredths(row.liters);
    entry.cost += toHundredths(row.total_cost);
  }

  const states = new Map((await getBusRecordStates([...perBus.keys()])).map((bus) => [bus.id, bus]));
  const buses = [...perBus.entries()].map(([busId, entry]) => ({
    busId,
    busNumber: states.get(busId)?.busNumber ?? null,
    isBusArchived: states.get(busId)?.isArchived ?? null,
    recordCount: entry.odometers.length,
    totalLiters: formatHundredths(entry.liters),
    totalCost: formatHundredths(entry.cost),
    efficiency: estimateFuelEfficiency(entry.odometers, entry.liters),
  }));

  const totalLiters = [...perBus.values()].reduce((sum, entry) => sum + entry.liters, 0);
  const totalCost = [...perBus.values()].reduce((sum, entry) => sum + entry.cost, 0);
  const efficiency = filters.busId
    ? (buses[0]?.efficiency ?? estimateFuelEfficiency([], 0))
    : combineEfficiency(buses.map((bus) => bus.efficiency));

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    busId: filters.busId ?? null,
    archived: filters.archived,
    recordCount: result.rows.length,
    totalLiters: formatHundredths(totalLiters),
    totalCost: formatHundredths(totalCost),
    efficiency,
    buses,
  };
}