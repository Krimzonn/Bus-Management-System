import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCreateInput, parseListFilters, parseOwnListFilters, parseScheduleId, parseUpdateInput,
} from "./validation.js";

const valid = {
  travelDate: "2027-03-15", departureTime: "08:00", arrivalTime: "12:30", busId: "1",
};
const create = (overrides) => parseCreateInput({ ...valid, ...overrides });
const rejects = (overrides, code) =>
  assert.throws(() => create(overrides), { code, status: 400 }, JSON.stringify(overrides));

test("create input accepts omitted or null driver and route, and numeric ids", () => {
  assert.deepEqual(create(), { ...valid, driverId: null, routeId: null });
  assert.deepEqual(create({ driverId: null, routeId: null }), { ...valid, driverId: null, routeId: null });
  assert.deepEqual(create({ busId: 7, driverId: "008", routeId: 9 }),
    { ...valid, busId: "7", driverId: "8", routeId: "9" });
});

test("travel date partitions and boundaries", () => {
  for (const travelDate of ["1900-01-01", "2028-02-29", "2027-12-31", "9999-12-30"]) {
    assert.equal(create({ travelDate }).travelDate, travelDate);
  }
  for (const travelDate of [
    "1899-12-31", "9999-12-31", "2027-02-29", "2027-13-01", "2027-00-10", "2027-04-31",
    "2027-3-15", "15-03-2027", "2027-03-15T00:00:00Z", " 2027-03-15", "", null, undefined, 20270315,
  ]) rejects({ travelDate }, "INVALID_TRAVEL_DATE");
});

test("time partitions and boundaries", () => {
  for (const time of ["00:00", "00:01", "09:59", "19:59", "23:59"]) {
    assert.equal(create({ departureTime: time, arrivalTime: "12:00" }).departureTime, time);
    assert.equal(create({ departureTime: "12:00", arrivalTime: time }).arrivalTime, time);
  }
  for (const bad of [
    "24:00", "23:60", "-1:00", "8:00", "08:0", "08:00:00", "0800", "8 AM", "", null, undefined, 800,
  ]) {
    rejects({ departureTime: bad }, "INVALID_DEPARTURE_TIME");
    rejects({ arrivalTime: bad }, "INVALID_ARRIVAL_TIME");
  }
});

test("equal times are invalid; an earlier arrival (overnight) is valid", () => {
  for (const time of ["00:00", "12:00", "23:59"]) {
    rejects({ departureTime: time, arrivalTime: time }, "INVALID_TRIP_TIMES");
  }
  assert.equal(create({ departureTime: "12:00", arrivalTime: "11:59" }).arrivalTime, "11:59");
  assert.equal(create({ departureTime: "23:59", arrivalTime: "00:00" }).arrivalTime, "00:00");
});

test("ids and unknown fields", () => {
  for (const bad of ["0", "-1", "1.5", "abc", "", 0, -3, 1.5, 2 ** 60, "1".repeat(19), {}, []]) {
    rejects({ busId: bad }, "INVALID_BUS_ID");
    rejects({ driverId: bad }, "INVALID_DRIVER_ID");
    rejects({ routeId: bad }, "INVALID_ROUTE_ID");
  }
  rejects({ busId: undefined }, "INVALID_BUS_ID");
  for (const extra of [{ status: "completed" }, { startedAt: "x" }, { id: "3" }]) {
    rejects(extra, "INVALID_INPUT");
  }
  for (const body of [undefined, null, [], "x"]) {
    assert.throws(() => parseCreateInput(body), { code: "INVALID_INPUT" });
  }
  assert.equal(parseScheduleId("12"), "12");
  assert.throws(() => parseScheduleId("mine"), { code: "INVALID_SCHEDULE_ID" });
});

test("update input is partial, non-empty, never status and never null", () => {
  assert.deepEqual(parseUpdateInput({ driverId: 4 }), { driverId: "4" });
  assert.deepEqual(parseUpdateInput({ arrivalTime: "01:00" }), { arrivalTime: "01:00" });
  assert.throws(() => parseUpdateInput({}), { code: "INVALID_INPUT" });
  assert.throws(() => parseUpdateInput({ status: "cancelled" }), { code: "INVALID_INPUT" });
  assert.throws(() => parseUpdateInput({ driverId: null }), { code: "INVALID_DRIVER_ID" });
  assert.throws(() => parseUpdateInput({ routeId: null }), { code: "INVALID_ROUTE_ID" });
});

test("list filters apply defaults and reject bad or unknown values", () => {
  assert.deepEqual(parseListFilters({}), { page: 1, limit: 25 });
  assert.deepEqual(
    parseListFilters({
      dateFrom: "2027-01-01", dateTo: "2027-01-01", status: "in_progress",
      busId: "1", driverId: "2", routeId: "3", page: "2", limit: "100",
    }),
    {
      dateFrom: "2027-01-01", dateTo: "2027-01-01", status: "in_progress",
      busId: "1", driverId: "2", routeId: "3", page: 2, limit: 100,
    },
  );
  for (const query of [
    { dateFrom: "2027-01-02", dateTo: "2027-01-01" }, { dateFrom: "2027-02-30" },
    { status: "delayed" }, { status: ["scheduled"] }, { busId: "x" }, { q: "abc" },
  ]) {
    assert.throws(() => parseListFilters(query), { code: "INVALID_SCHEDULE_FILTER" }, JSON.stringify(query));
  }
  for (const query of [{ page: "0" }, { limit: "101" }, { page: "10001" }, { limit: "x" }]) {
    assert.throws(() => parseListFilters(query), { code: "INVALID_PAGINATION" });
  }
});

test("a driver's own list cannot be filtered by assignment", () => {
  assert.deepEqual(parseOwnListFilters({ status: "scheduled" }), { status: "scheduled", page: 1, limit: 25 });
  for (const key of ["driverId", "busId", "routeId"]) {
    assert.throws(() => parseOwnListFilters({ [key]: "1" }), { code: "INVALID_SCHEDULE_FILTER" });
  }
});
