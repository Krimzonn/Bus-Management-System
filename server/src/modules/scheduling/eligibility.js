// Assignment eligibility policy (ADR-004, BR-01/02/03/13). The rules themselves
// live in Fleet, Routes and Drivers; this module only combines their answers.
import { getDriverAssignmentEligibility, lockDriverForAssignment } from "../drivers/index.js";
import {
  getBusAssignmentEligibility, getBusScheduleDefaults, lockBusForAssignment,
} from "../fleet/index.js";
import { getRouteAssignmentEligibility, lockRouteForAssignment } from "../routes/index.js";
import { scheduleError } from "./validation.js";

function assertEligible({ eligible, reason }) {
  if (eligible) return;
  throw scheduleError(reason, reason.endsWith("_NOT_FOUND") ? 404 : 409);
}

// Checks one proposed assignment inside the caller's transaction and returns the
// ids to save. A missing driverId or routeId is taken from the bus defaults,
// which are validated exactly like an explicit choice. Each record is share
// locked before it is read, so it cannot change before the transaction ends.
export async function resolveAssignment(client, { travelDate, busId, driverId, routeId }) {
  await lockBusForAssignment(busId, client);
  const bus = await getBusAssignmentEligibility(busId, client);
  assertEligible(bus);

  const assignment = { busId, driverId, routeId };
  if (!assignment.driverId || !assignment.routeId) {
    const defaults = await getBusScheduleDefaults(busId, client);
    assignment.routeId ||= defaults.defaultRouteId;
    assignment.driverId ||= defaults.defaultDriverId;
  }
  if (!assignment.routeId) throw scheduleError("ROUTE_REQUIRED", 400);
  if (!assignment.driverId) throw scheduleError("DRIVER_REQUIRED", 400);

  await lockRouteForAssignment(assignment.routeId, client);
  assertEligible(await getRouteAssignmentEligibility(assignment.routeId, client));

  await lockDriverForAssignment(assignment.driverId, client);
  assertEligible(await getDriverAssignmentEligibility(
    assignment.driverId,
    { tripDate: travelDate, requiredLicenseCategory: bus.requiredLicenseCategory },
    client,
  ));
  return assignment;
}
