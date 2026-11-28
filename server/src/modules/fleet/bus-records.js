import { pool } from "../../database/db.js";

// Public read-only interface for modules that keep records about a bus (Fuel).
// Returns display data and the archived flag for every id that exists, archived
// buses included, so history stays readable. Unknown ids are simply absent.
export async function getBusRecordStates(ids, executor = pool) {
  if (!ids.length) return [];
  const result = await executor.query(
    "SELECT id, bus_number, is_archived FROM fleet_buses WHERE id = ANY($1::bigint[])",
    [ids],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    busNumber: row.bus_number,
    isArchived: row.is_archived,
  }));
}