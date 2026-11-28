// Constants, validation and formatting for the schedule screens. Validation mirrors
// server/src/modules/scheduling/validation.js for early feedback only: the backend
// decides eligibility, conflicts and status changes.

import { ApiError, errorMessage } from "../../services/api.js";

export const PAGE_SIZE = 25;
export const MIN_TRAVEL_DATE = "1900-01-01";
export const MAX_TRAVEL_DATE = "9999-12-30";

export const SCHEDULE_STATUSES = [
  { value: "scheduled", label: "Scheduled", tone: "navy" },
  { value: "in_progress", label: "In progress", tone: "gold" },
  { value: "completed", label: "Completed", tone: "green" },
  { value: "cancelled", label: "Cancelled", tone: "grey" },
];
export const STATUS_BY_VALUE = Object.fromEntries(
  SCHEDULE_STATUSES.map((status) => [status.value, status]),
);

/* ---- Error text. Codes come from the backend; wording lives only here. ---- */

const SCHEDULE_ERRORS = {
  SCHEDULE_BUS_CONFLICT:
    "This bus already has a scheduled or in-progress trip that overlaps these times. Back-to-back trips are allowed; overlapping ones are not.",
  SCHEDULE_DRIVER_CONFLICT:
    "This driver already has a scheduled or in-progress trip that overlaps these times. Back-to-back trips are allowed; overlapping ones are not.",
  SCHEDULE_CONCURRENT_UPDATE:
    "Another change happened at the same moment. Please try again.",
  BUS_INACTIVE: "This bus is Inactive and cannot be assigned to new trips.",
  BUS_UNDER_MAINTENANCE: "This bus is Under maintenance and cannot be assigned to new trips.",
  BUS_ARCHIVED: "This bus is archived and cannot be assigned.",
  BUS_NOT_FOUND: "The selected bus no longer exists. Refresh and choose another.",
  ROUTE_BLOCKED: "This route is Blocked and cannot be assigned to new trips.",
  ROUTE_ARCHIVED: "This route is archived and cannot be assigned.",
  ROUTE_UNAVAILABLE: "This route is not available for assignment.",
  ROUTE_NOT_FOUND: "The selected route no longer exists. Refresh and choose another.",
  DRIVER_ON_LEAVE: "This driver is On leave and cannot be assigned.",
  DRIVER_ABSENT: "This driver is Absent and cannot be assigned.",
  DRIVER_UNAVAILABLE: "This driver is not available for assignment.",
  DRIVER_ARCHIVED: "This driver is archived and cannot be assigned.",
  DRIVER_NOT_FOUND: "The selected driver no longer exists. Refresh and choose another.",
  LICENSE_EXPIRED: "This driver’s license is not valid on the travel date.",
  LICENSE_CATEGORY_MISMATCH:
    "The driver’s license category does not match the category this bus requires.",
  ROUTE_REQUIRED: "Choose a route. This bus has no default route.",
  DRIVER_REQUIRED: "Choose a driver. This bus has no default driver.",
  INVALID_TRAVEL_DATE: "Enter a valid travel date.",
  INVALID_DEPARTURE_TIME: "Enter a valid departure time (HH:MM).",
  INVALID_ARRIVAL_TIME: "Enter a valid arrival time (HH:MM).",
  INVALID_TRIP_TIMES: "Departure and arrival times must be different.",
  INVALID_BUS_ID: "Choose a valid bus.",
  INVALID_DRIVER_ID: "Choose a valid driver.",
  INVALID_ROUTE_ID: "Choose a valid route.",
  INVALID_SCHEDULE_ID: "This schedule identifier is not valid.",
  INVALID_SCHEDULE_FILTER: "One of the filters is not valid. Check the values and try again.",
  SCHEDULE_NOT_FOUND: "This trip no longer exists or is not available to you. Refresh the list.",
  SCHEDULE_NOT_EDITABLE: "Only a trip that has not started can be edited.",
  INVALID_SCHEDULE_TRANSITION:
    "That action is no longer possible because the trip’s status changed. The details have been refreshed.",
  DRIVER_ACCOUNT_NOT_LINKED:
    "Your login is not linked to a driver record yet. Ask an Admin to link it.",
  INVALID_INPUT: "The trip details were not accepted. Check the values and try again.",
};

export function scheduleErrorMessage(error) {
  if (error instanceof ApiError && Object.hasOwn(SCHEDULE_ERRORS, error.code)) {
    return SCHEDULE_ERRORS[error.code];
  }
  return errorMessage(error);
}

// Errors meaning "your copy of this trip is out of date".
export const STALE_CODES = new Set([
  "SCHEDULE_NOT_FOUND",
  "SCHEDULE_NOT_EDITABLE",
  "INVALID_SCHEDULE_TRANSITION",
]);

// Which form field a backend error code belongs to (used to flag the field).
export const FIELD_FOR_CODE = {
  INVALID_TRAVEL_DATE: "travelDate",
  INVALID_DEPARTURE_TIME: "departureTime",
  INVALID_ARRIVAL_TIME: "arrivalTime",
  INVALID_TRIP_TIMES: "arrivalTime",
  INVALID_BUS_ID: "busId",
  BUS_INACTIVE: "busId",
  BUS_UNDER_MAINTENANCE: "busId",
  BUS_ARCHIVED: "busId",
  BUS_NOT_FOUND: "busId",
  SCHEDULE_BUS_CONFLICT: "busId",
  INVALID_DRIVER_ID: "driverId",
  DRIVER_ON_LEAVE: "driverId",
  DRIVER_ABSENT: "driverId",
  DRIVER_UNAVAILABLE: "driverId",
  DRIVER_ARCHIVED: "driverId",
  DRIVER_NOT_FOUND: "driverId",
  DRIVER_REQUIRED: "driverId",
  LICENSE_EXPIRED: "driverId",
  LICENSE_CATEGORY_MISMATCH: "driverId",
  SCHEDULE_DRIVER_CONFLICT: "driverId",
  INVALID_ROUTE_ID: "routeId",
  ROUTE_BLOCKED: "routeId",
  ROUTE_ARCHIVED: "routeId",
  ROUTE_UNAVAILABLE: "routeId",
  ROUTE_NOT_FOUND: "routeId",
  ROUTE_REQUIRED: "routeId",
};

/* ---- Dates and times (calendar dates are "YYYY-MM-DD" strings) ---- */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  return addDays(value, 0) === value;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const longDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDate(value, long = false) {
  if (!isCalendarDate(value)) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return (long ? longDateFmt : dateFmt).format(new Date(year, month - 1, day));
}

export function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "—";
}

export const isOvernight = (departureTime, arrivalTime) => arrivalTime < departureTime;

/* ---- Form validation ---- */

export function validateScheduleForm(values, mode, buses = []) {
  const errors = {};
  const date = values.travelDate.trim();
  if (!isCalendarDate(date) || date < MIN_TRAVEL_DATE || date > MAX_TRAVEL_DATE) {
    errors.travelDate = "Enter a valid travel date.";
  }
  if (!TIME_PATTERN.test(values.departureTime)) errors.departureTime = "Enter a departure time.";
  if (!TIME_PATTERN.test(values.arrivalTime)) errors.arrivalTime = "Enter an arrival time.";
  if (
    !errors.departureTime &&
    !errors.arrivalTime &&
    values.departureTime === values.arrivalTime
  ) {
    errors.arrivalTime = "Arrival must be different from departure. An earlier time means the next day.";
  }
  if (!values.busId) errors.busId = "Choose a bus.";

  const bus = buses.find((item) => item.id === values.busId);
  if (mode === "create") {
    if (!values.driverId && bus && !bus.defaultDriverId) {
      errors.driverId = "Choose a driver. This bus has no default driver.";
    }
    if (!values.routeId && bus && !bus.defaultRouteId) {
      errors.routeId = "Choose a route. This bus has no default route.";
    }
  } else {
    if (!values.driverId) errors.driverId = "Choose a driver.";
    if (!values.routeId) errors.routeId = "Choose a route.";
  }
  if (Object.keys(errors).length > 0) return { errors, input: null };

  return {
    errors,
    input: {
      travelDate: date,
      departureTime: values.departureTime,
      arrivalTime: values.arrivalTime,
      busId: values.busId,
      driverId: values.driverId || null,
      routeId: values.routeId || null,
    },
  };
}

const FIELDS = ["travelDate", "departureTime", "arrivalTime", "busId", "driverId", "routeId"];

// Only the fields that actually differ from the saved schedule.
export function diffSchedule(schedule, input) {
  const changes = {};
  for (const key of FIELDS) if (input[key] && input[key] !== schedule[key]) changes[key] = input[key];
  return changes;
}

/* ---- Option lists and advisory hints (the server still decides) ---- */

export const busOk = (bus) => !bus.isArchived && bus.status === "active";
export const driverOk = (driver) => !driver.isArchived && driver.status === "available";
export const routeOk = (route) => !route.isArchived && route.status === "unblocked";

export const selectable = (items, ok, currentId) =>
  items.filter((item) => ok(item) || item.id === currentId);

export const busLabel = (bus) =>
  `${bus.busNumber} · ${bus.seatingCapacity} seats · ${bus.requiredLicenseCategory}${busOk(bus) ? "" : " (unavailable)"}`;
export const driverLabel = (driver) =>
  `${driver.fullName} · ${driver.licenseCategory}${driverOk(driver) ? "" : " (unavailable)"}`;
export const routeLabel = (route) =>
  `${route.routeCode} · ${route.origin} → ${route.destination}${routeOk(route) ? "" : " (unavailable)"}`;

export function advisoryMessages(values, { buses, drivers, routes }) {
  const out = [];
  const bus = buses.find((item) => item.id === values.busId);
  const driver = drivers.find((item) => item.id === (values.driverId || bus?.defaultDriverId));
  const route = routes.find((item) => item.id === (values.routeId || bus?.defaultRouteId));
  if (bus && !busOk(bus)) out.push(`Bus ${bus.busNumber} is currently not assignable.`);
  if (driver && !driverOk(driver)) out.push(`${driver.fullName} is currently not assignable.`);
  if (route && !routeOk(route)) out.push(`Route ${route.routeCode} is currently not assignable.`);
  if (bus && driver && bus.requiredLicenseCategory !== driver.licenseCategory) {
    out.push(
      `${driver.fullName} holds category ${driver.licenseCategory}, but this bus requires ${bus.requiredLicenseCategory}.`,
    );
  }
  if (driver && isCalendarDate(values.travelDate) && driver.licenseExpiryDate < values.travelDate) {
    out.push(`${driver.fullName}’s license expires before the travel date.`);
  }
  return out;
}
