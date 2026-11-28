// Slice 8: replacement driver suggestions and reassignment (ADR-004, BR-04).
//
// Suggestions are advisory and read-only. The manager chooses; nothing is ever
// assigned automatically. The final save re-runs every eligibility rule inside
// the transaction (share locks via resolveAssignment) and relies on the database
// exclusion constraint for overlap, so a stale suggestion can never produce an
// invalid assignment, even under concurrent requests.
import { pool } from "../../database/db.js";
import { recordStrict } from "../audit/writer.js";
import { listReplacementCandidates } from "../drivers/index.js";
import { getBusAssignmentEligibility } from "../fleet/index.js";
import { getRouteAssignmentEligibility } from "../routes/index.js";
import { resolveAssignment } from "./eligibility.js";
import { publishScheduleEvent } from "./notification-seam.js";
import {
  COLUMNS, TABLE, lockSchedule, toSchedule, withSummary, writeSchedule,
} from "./service.js";
import { parseScheduleId, scheduleError } from "./validation.js";

// Drivers (already evaluated by Drivers for status, archival, license, category)
// that hold a scheduled or in-progress trip overlapping this schedule. Uses the
// same half-open trip_period as the exclusion constraints, so back-to-back trips
// are not conflicts and cancelled/completed trips are ignored.
const BUSY_DRIVERS_SQL = `
  SELECT DISTINCT s.driver_id
  FROM ${TABLE} s
  WHERE s.driver_id = ANY($1::bigint[])
    AND s.status IN ('scheduled', 'in_progress')
    AND s.trip_period && (SELECT trip_period FROM ${TABLE} WHERE id = $2)`;

// Body: { driverId } and nothing else.
function parseReplacementInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw scheduleError("INVALID_INPUT", 400);
  for (const key of Object.keys(body)) {
    if (key !== "driverId") throw scheduleError("INVALID_INPUT", 400);
  }
  const value = body.driverId;
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text) || BigInt(text) < 1n) {
    throw scheduleError("INVALID_DRIVER_ID", 400);
  }
  return String(BigInt(text));
}

// Names the first stage at which nobody was left, so an empty list is explained.
function emptyReason(summary) {
  if (summary.evaluated === 0) return "NO_ACTIVE_DRIVERS";
  if (summary.available === 0) return "NO_AVAILABLE_DRIVERS";
  if (summary.licenseValid === 0) return "NO_VALID_LICENSE";
  if (summary.categoryQualified === 0) return "NO_CATEGORY_MATCH";
  return "ALL_HAVE_CONFLICTS";
}

export async function getReplacementCandidates(id) {
  const scheduleId = parseScheduleId(id);
  const result = await pool.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = $1`, [scheduleId]);
  if (!result.rows.length) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
  const schedule = toSchedule(result.rows[0]);
  if (schedule.status !== "scheduled") throw scheduleError("SCHEDULE_NOT_EDITABLE", 409);

  const base = {
    scheduleId: schedule.id,
    travelDate: schedule.travelDate,
    departureTime: schedule.departureTime,
    arrivalTime: schedule.arrivalTime,
    arrivalDate: schedule.arrivalDate,
    currentDriverId: schedule.driverId,
  };
  const blocked = (reason) => ({ ...base, candidates: [], summary: null, emptyReason: reason });

  // A save revalidates bus and route too, so nobody can be chosen while either
  // is no longer assignable. The category requirement also comes from the bus.
  const bus = await getBusAssignmentEligibility(schedule.busId);
  if (!bus.eligible) return blocked(bus.reason);
  const route = await getRouteAssignmentEligibility(schedule.routeId);
  if (!route.eligible) return blocked(route.reason);

  const { candidates, funnel } = await listReplacementCandidates({
    tripDate: schedule.travelDate,
    requiredLicenseCategory: bus.requiredLicenseCategory,
    excludeDriverId: schedule.driverId,
  });

  let free = candidates;
  if (candidates.length) {
    const busy = await pool.query(BUSY_DRIVERS_SQL, [candidates.map((c) => c.id), scheduleId]);
    const busyIds = new Set(busy.rows.map((row) => String(row.driver_id)));
    free = candidates.filter((candidate) => !busyIds.has(candidate.id));
  }
  const summary = { ...funnel, withoutConflict: free.length };
  return {
    ...base,
    candidates: free,
    summary,
    emptyReason: free.length ? null : emptyReason(summary),
  };
}

export async function replaceDriver({ id, input, actorId, actorEmail }) {
  const scheduleId = parseScheduleId(id);
  const newDriverId = parseReplacementInput(input);

  const { schedule, previousDriverId } = await writeSchedule(async (client) => {
    const before = await lockSchedule(client, scheduleId);
    if (!before) throw scheduleError("SCHEDULE_NOT_FOUND", 404);
    if (before.status !== "scheduled") throw scheduleError("SCHEDULE_NOT_EDITABLE", 409);
    if (before.driverId === newDriverId) throw scheduleError("REPLACEMENT_SAME_DRIVER", 409);

    // Share-locks and rechecks bus, route and the new driver (status, archival,
    // license on the travel date, category). Overlap is enforced by the
    // exclusion constraint on the UPDATE below.
    await resolveAssignment(client, { ...before, driverId: newDriverId });

    const result = await client.query(
      `UPDATE ${TABLE}
       SET driver_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING ${COLUMNS}`,
      [newDriverId, scheduleId],
    );
    const after = toSchedule(result.rows[0]);
    await recordStrict(client, {
      actorId, actorEmail, action: "schedule.driver_replaced", entityType: "schedule",
      entityId: scheduleId,
      before: { driverId: before.driverId }, after: { driverId: after.driverId },
    });
    return { schedule: await withSummary(after, client), previousDriverId: before.driverId };
  });

  publishScheduleEvent({
    type: "schedule.replacement_assigned", scheduleId, driverId: newDriverId, previousDriverId,
  });
  return schedule;
}