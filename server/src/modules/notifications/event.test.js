import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../database/db.js";
import {
  ALERT_RECIPIENT_ROLES,
  configureNotificationPorts,
  handleScheduleEvent,
  notifyApplicantStatusChange,
  resetNotificationPorts,
  runAlertCheck,
} from "./events.js";
import { EVENT_TYPES } from "./templates.js";

// Fake database that behaves like the unique (recipient_id, dedupe_key) index.
function useInserts(t) {
  const inserts = [];
  const seen = new Set();
  t.mock.method(pool, "query", async (_sql, values) => {
    const key = values[6] == null ? null : `${values[0]}|${values[6]}`;
    if (key && seen.has(key)) return { rows: [] };
    if (key) seen.add(key);
    inserts.push({
      recipientId: values[0],
      eventType: values[1],
      title: values[2],
      message: values[3],
      entityType: values[4],
      entityId: values[5],
      dedupeKey: values[6],
    });
    return { rows: [{ id: String(inserts.length) }] };
  });
  t.after(() => resetNotificationPorts());
  return inserts;
}

for (const [type, eventType] of [
  ["schedule.assigned", EVENT_TYPES.SCHEDULE_ASSIGNED],
  ["schedule.changed", EVENT_TYPES.SCHEDULE_CHANGED],
  ["schedule.cancelled", EVENT_TYPES.SCHEDULE_CANCELLED],
  ["schedule.replacement_assigned", EVENT_TYPES.SCHEDULE_REPLACEMENT_ASSIGNED],
]) {
  test(`${type} notifies the driver's linked account, not the driver record id`, async (t) => {
    const inserts = useInserts(t);
    const asked = [];
    configureNotificationPorts({
      resolveDriverAccountId: async (driverId) => {
        asked.push(driverId);
        return driverId === "2" ? "42" : null;
      },
    });
    await handleScheduleEvent({
      type,
      scheduleId: "9",
      driverId: "2",
      previousDriverId: "1",
    });
    assert.deepEqual(asked, ["2"]);
    assert.deepEqual(
      inserts.map((i) => [
        i.recipientId,
        i.eventType,
        i.entityType,
        i.entityId,
        i.dedupeKey,
      ]),
      [["42", eventType, "schedule", "9", null]],
    );
    assert.match(inserts[0].message, /#9/);
  });
}

test("a driver without a login account, or an unknown event, creates nothing", async (t) => {
  const inserts = useInserts(t);
  configureNotificationPorts({ resolveDriverAccountId: async () => null });
  await handleScheduleEvent({
    type: "schedule.assigned",
    scheduleId: "9",
    driverId: "2",
  });
  await handleScheduleEvent({
    type: "schedule.unknown",
    scheduleId: "9",
    driverId: "2",
  });
  await handleScheduleEvent(undefined);
  assert.deepEqual(inserts, []);
});

test("schedule event handling never throws, even if the lookup, the database or the wiring fails", async (t) => {
  t.mock.method(console, "warn", () => {});
  const inserts = useInserts(t);
  configureNotificationPorts({
    resolveDriverAccountId: async () => {
      throw new Error("lookup failed");
    },
  });
  await assert.doesNotReject(
    handleScheduleEvent({
      type: "schedule.assigned",
      scheduleId: "9",
      driverId: "2",
    }),
  );
  resetNotificationPorts();
  await assert.doesNotReject(
    handleScheduleEvent({
      type: "schedule.assigned",
      scheduleId: "9",
      driverId: "2",
    }),
  );
  configureNotificationPorts({ resolveDriverAccountId: async () => "42" });
  t.mock.restoreAll();
  t.mock.method(console, "warn", () => {});
  t.mock.method(pool, "query", async () => {
    throw new Error("db down");
  });
  await assert.doesNotReject(
    handleScheduleEvent({
      type: "schedule.assigned",
      scheduleId: "9",
      driverId: "2",
    }),
  );
  assert.deepEqual(inserts, []);
});

test("unknown or non-function ports are rejected when configuring", () => {
  assert.throws(
    () => configureNotificationPorts({ other: () => {} }),
    /Unknown notification port/,
  );
  assert.throws(
    () => configureNotificationPorts({ listLicenseAlerts: "x" }),
    TypeError,
  );
});

test("an applicant is notified once per application status", async (t) => {
  const inserts = useInserts(t);
  const input = { applicantId: "12", applicationId: "31", status: "selected" };
  assert.deepEqual(await notifyApplicantStatusChange(input), {
    created: 1,
    duplicates: 0,
    failed: 0,
  });
  assert.deepEqual(await notifyApplicantStatusChange(input), {
    created: 0,
    duplicates: 1,
    failed: 0,
  });
  await notifyApplicantStatusChange({ ...input, status: "rejected" });
  assert.equal(inserts.length, 2);
  assert.deepEqual(
    [
      inserts[0].recipientId,
      inserts[0].eventType,
      inserts[0].entityType,
      inserts[0].entityId,
      inserts[0].dedupeKey,
    ],
    [
      "12",
      "application.status_changed",
      "application",
      "31",
      "application:31:selected",
    ],
  );
  assert.match(inserts[0].message, /Selected/);
});

const licenses = [
  {
    driverId: "5",
    fullName: "Ali",
    licenseExpiryDate: "2026-12-01",
    state: "expired",
  },
  {
    driverId: "6",
    fullName: "Sara",
    licenseExpiryDate: "2026-12-20",
    state: "expiring_soon",
  },
];
const maintenance = [
  {
    recordId: "8",
    busNumber: "B-1",
    maintenanceType: "Oil change",
    nextServiceDate: "2026-12-01",
    status: "overdue",
  },
  {
    recordId: "9",
    busNumber: "B-2",
    maintenanceType: "Brakes",
    nextServiceDate: "2026-12-20",
    status: "upcoming",
  },
];

test("alerts go to every Admin and Transportation Manager, once per alert", async (t) => {
  const inserts = useInserts(t);
  const roleCalls = [];
  configureNotificationPorts({
    listAccountIdsByRoles: async (roles) => {
      roleCalls.push(roles);
      return ["1", "2"];
    },
    listLicenseAlerts: async () => licenses,
    listMaintenanceDueAlerts: async () => maintenance,
  });

  const first = await runAlertCheck();
  assert.deepEqual(roleCalls, [["admin", "transportation_manager"]]);
  assert.deepEqual(
    [...ALERT_RECIPIENT_ROLES],
    ["admin", "transportation_manager"],
  );
  assert.deepEqual(first.licenses, { created: 4, duplicates: 0, failed: 0 });
  assert.deepEqual(first.maintenance, { created: 4, duplicates: 0, failed: 0 });
  for (const type of [
    EVENT_TYPES.LICENSE_EXPIRED,
    EVENT_TYPES.LICENSE_EXPIRING,
    EVENT_TYPES.MAINTENANCE_OVERDUE,
    EVENT_TYPES.MAINTENANCE_UPCOMING,
  ]) {
    assert.deepEqual(
      inserts
        .filter((i) => i.eventType === type)
        .map((i) => i.recipientId)
        .sort(),
      ["1", "2"],
      type,
    );
  }
  const keys = inserts.map((i) => i.dedupeKey);
  assert.ok(keys.includes("license:5:expired:2026-12-01"));
  assert.ok(keys.includes("license:6:expiring_soon:2026-12-20"));
  assert.ok(keys.includes("maintenance:8:overdue:2026-12-01"));
  assert.ok(keys.includes("maintenance:9:upcoming:2026-12-20"));
  assert.deepEqual(
    inserts.find((i) => i.eventType === EVENT_TYPES.LICENSE_EXPIRED).entityType,
    "driver",
  );
  assert.deepEqual(
    inserts.find((i) => i.eventType === EVENT_TYPES.MAINTENANCE_OVERDUE)
      .entityType,
    "maintenance",
  );

  // Running the check again is repeat-safe.
  const second = await runAlertCheck();
  assert.deepEqual(second.licenses, { created: 0, duplicates: 4, failed: 0 });
  assert.deepEqual(second.maintenance, {
    created: 0,
    duplicates: 4,
    failed: 0,
  });
  assert.equal(inserts.length, 8);
});

test("a renewed license or a new service date is a new alert", async (t) => {
  const inserts = useInserts(t);
  let alerts = [licenses[1]];
  configureNotificationPorts({
    listAccountIdsByRoles: async () => ["1"],
    listLicenseAlerts: async () => alerts,
    listMaintenanceDueAlerts: async () => [],
  });
  await runAlertCheck();
  alerts = [{ ...licenses[1], licenseExpiryDate: "2027-01-05" }];
  await runAlertCheck();
  assert.equal(inserts.length, 2);
});

test("no recipients means nothing is queried or created", async (t) => {
  const inserts = useInserts(t);
  configureNotificationPorts({
    listAccountIdsByRoles: async () => [],
    listLicenseAlerts: async () => assert.fail("must not be queried"),
    listMaintenanceDueAlerts: async () => assert.fail("must not be queried"),
  });
  assert.deepEqual(await runAlertCheck(), {
    licenses: { created: 0, duplicates: 0, failed: 0 },
    maintenance: { created: 0, duplicates: 0, failed: 0 },
  });
  assert.deepEqual(inserts, []);
});

test("one failing source does not stop the other, and nothing throws", async (t) => {
  t.mock.method(console, "warn", () => {});
  const inserts = useInserts(t);
  configureNotificationPorts({
    listAccountIdsByRoles: async () => ["1"],
    listLicenseAlerts: async () => {
      throw new Error("drivers down");
    },
    listMaintenanceDueAlerts: async () => maintenance,
  });
  const summary = await runAlertCheck();
  assert.equal(summary.licenses.failed, 1);
  assert.equal(summary.maintenance.created, 2);
  assert.equal(inserts.length, 2);

  configureNotificationPorts({
    listAccountIdsByRoles: async () => {
      throw new Error("iam down");
    },
  });
  await assert.doesNotReject(runAlertCheck());
});
