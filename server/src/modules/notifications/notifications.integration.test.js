import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";
import { pool } from "../../database/db.js";
import { addDays, businessToday } from "../../utils/business-date.js";
import {
  EVENT_TYPES,
  createNotificationsBestEffort,
  runAlertCheck,
} from "./index.js";

// Needs a migrated database and an Admin account (same variables as auth.integration.test.js).
const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;
const TEMP_PASSWORD = "Integration-Pass-123!";

async function openSession(base, userEmail, userPassword) {
  const csrfRes = await fetch(`${base}/auth/csrf`);
  const csrf = (await csrfRes.json()).data.csrfToken;
  let cookie = csrfRes.headers.getSetCookie()[0].split(";")[0];
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(loginRes.status, 200, `login failed for ${userEmail}`);
  cookie = loginRes.headers.getSetCookie()[0].split(";")[0];
  const token = (await loginRes.json()).data.csrfToken;
  return async (method, path, body, { csrf: sendCsrf = true } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(sendCsrf ? { "X-CSRF-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
}

test(
  "notifications against PostgreSQL",
  { skip: !email || !password },
  async (t) => {
    const server = app.listen(0);
    const created = {
      accounts: [],
      buses: [],
      drivers: [],
      routes: [],
      records: [],
    };
    let admin;
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      admin = await openSession(base, email, password);
      const stamp = Date.now();
      let sequence = 0;
      const today = businessToday();
      const day = addDays(today, 400);

      const ok = async (promise, status = 200) => {
        const res = await promise;
        assert.equal(res.status, status, JSON.stringify(res.body));
        return res.body.data;
      };
      const failsWith = async (promise, status, code) => {
        const res = await promise;
        assert.deepEqual(
          [res.status, res.body.code],
          [status, code],
          JSON.stringify(res.body),
        );
        assert.equal(res.body.data, null);
      };
      // Notifications are created after the response, so wait for them.
      const eventually = async (check, message) => {
        for (let i = 0; i < 40; i += 1) {
          if (await check()) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail(message);
      };

      async function account(role) {
        const userEmail = `it-notif-${role ?? "none"}-${stamp}-${(sequence += 1)}@example.com`;
        const { id } = await ok(
          admin("POST", "/accounts", {
            email: userEmail,
            password: TEMP_PASSWORD,
          }),
          201,
        );
        created.accounts.push(id);
        if (role) await ok(admin("PUT", `/accounts/${id}/role`, { role }));
        return { id, call: await openSession(base, userEmail, TEMP_PASSWORD) };
      }
      const allFor = async (session, query = "") => {
        const items = [];
        for (let page = 1; page <= 200; page += 1) {
          const data = await ok(
            session("GET", `/notifications?limit=100&page=${page}${query}`),
          );
          items.push(...data.items);
          if (items.length >= data.total || data.items.length === 0) break;
        }
        return items;
      };
      const make = (recipient, n) =>
        createNotificationsBestEffort([
          {
            recipientId: recipient.id,
            eventType: EVENT_TYPES.SCHEDULE_ASSIGNED,
            entityId: String(n),
            data: { scheduleId: String(n) },
          },
        ]);

      const manager = await account("transportation_manager");

      async function newBus() {
        const bus = await ok(
          manager.call("POST", "/buses", {
            busNumber: `NT${stamp}-${(sequence += 1)}`,
            seatingCapacity: 40,
            requiredLicenseCategory: "HTV",
          }),
          201,
        );
        created.buses.push(bus.id);
        return bus;
      }
      async function newDriver(overrides = {}) {
        const n = (sequence += 1);
        const driver = await ok(
          manager.call("POST", "/drivers", {
            fullName: `Notify Driver ${stamp} ${n}`,
            licenseNumber: `ND-${stamp}-${n}`,
            licenseCategory: "HTV",
            licenseExpiryDate: addDays(day, 3000),
            ...overrides,
          }),
          201,
        );
        created.drivers.push(driver.id);
        return driver;
      }
      async function newRoute() {
        const route = await ok(
          manager.call("POST", "/routes", {
            routeCode: `NR${stamp}-${(sequence += 1)}`,
            name: "Test",
            origin: "A",
            destination: "B",
          }),
          201,
        );
        created.routes.push(route.id);
        return route;
      }
      async function linkedDriver() {
        const login = await account("driver");
        const driver = await newDriver();
        await ok(
          admin("PUT", `/drivers/${driver.id}/account`, { userId: login.id }),
        );
        return { login, driver };
      }

      await t.test("list, count, mark-read and access isolation", async () => {
        const a = await account("transportation_manager");
        const b = await account("transportation_manager");
        for (const n of [1, 2, 3]) await make(a, n);
        await make(b, 9);

        const list = await ok(a.call("GET", "/notifications"));
        assert.equal(list.total, 3);
        assert.deepEqual(
          list.items.map((i) => i.entityId),
          ["3", "2", "1"],
        ); // newest first
        assert.ok(
          list.items.every((i) => i.isRead === false && i.readAt === null),
        );
        assert.equal("recipientId" in list.items[0], false);
        assert.equal(
          (await ok(a.call("GET", "/notifications/unread-count"))).count,
          3,
        );
        assert.equal(
          (await ok(b.call("GET", "/notifications/unread-count"))).count,
          1,
        );

        const page2 = await ok(a.call("GET", "/notifications?limit=2&page=2"));
        assert.deepEqual([page2.items.length, page2.total], [1, 3]);

        const first = list.items[0];
        const read = await ok(
          a.call("POST", `/notifications/${first.id}/read`),
        );
        assert.equal(read.isRead, true);
        assert.ok(read.readAt);
        const again = await ok(
          a.call("POST", `/notifications/${first.id}/read`),
        );
        assert.equal(again.readAt, read.readAt); // idempotent, first read time kept
        assert.equal(
          (await ok(a.call("GET", "/notifications/unread-count"))).count,
          2,
        );
        const unread = await ok(a.call("GET", "/notifications?unread=true"));
        assert.equal(unread.total, 2);
        assert.equal(
          unread.items.some((i) => i.id === first.id),
          false,
        );
        assert.equal((await ok(a.call("GET", "/notifications"))).total, 3); // history keeps read items

        // Isolation: guessed ids look exactly like missing ones, and nothing changes.
        const [theirs] = (await ok(b.call("GET", "/notifications"))).items;
        await failsWith(
          a.call("POST", `/notifications/${theirs.id}/read`),
          404,
          "NOTIFICATION_NOT_FOUND",
        );
        await failsWith(
          a.call("POST", "/notifications/999999999/read"),
          404,
          "NOTIFICATION_NOT_FOUND",
        );
        assert.equal(
          (await ok(b.call("GET", "/notifications/unread-count"))).count,
          1,
        );
        assert.equal(
          (await ok(a.call("GET", "/notifications"))).items.some(
            (i) => i.id === theirs.id,
          ),
          false,
        );

        // Validation and authorization.
        await failsWith(
          a.call("GET", "/notifications?page=0"),
          400,
          "INVALID_PAGINATION",
        );
        await failsWith(
          a.call("GET", "/notifications?unread=maybe"),
          400,
          "INVALID_NOTIFICATION_FILTER",
        );
        await failsWith(
          a.call("GET", `/notifications?recipientId=${b.id}`),
          400,
          "INVALID_NOTIFICATION_FILTER",
        );
        await failsWith(
          a.call("POST", "/notifications/abc/read"),
          400,
          "INVALID_NOTIFICATION_ID",
        );
        await failsWith(
          a.call("POST", `/notifications/${list.items[1].id}/read`, undefined, {
            csrf: false,
          }),
          403,
          "CSRF_VALIDATION_FAILED",
        );
        for (const path of ["/notifications", "/notifications/unread-count"]) {
          assert.equal((await fetch(`${base}${path}`)).status, 401, path);
        }
        assert.equal(
          (await fetch(`${base}/notifications/1/read`, { method: "POST" }))
            .status,
          401,
        );
        const noRole = await account(null);
        await failsWith(
          noRole.call("GET", "/notifications"),
          403,
          "INSUFFICIENT_PERMISSION",
        );
        await failsWith(
          noRole.call("GET", "/notifications/unread-count"),
          403,
          "INSUFFICIENT_PERMISSION",
        );
        await failsWith(
          noRole.call("POST", `/notifications/${first.id}/read`),
          403,
          "INSUFFICIENT_PERMISSION",
        );
      });

      await t.test("history is retained at the database level", async () => {
        const a = await account("administrative_staff");
        await make(a, 1);
        const [item] = (await ok(a.call("GET", "/notifications"))).items;
        await assert.rejects(
          pool.query(
            "UPDATE notifications_notifications SET title = 'x' WHERE id = $1",
            [item.id],
          ),
          /notifications/,
        );
        await assert.rejects(
          pool.query("DELETE FROM notifications_notifications WHERE id = $1", [
            item.id,
          ]),
          /notifications/,
        );
        await ok(a.call("POST", `/notifications/${item.id}/read`));
        await assert.rejects(
          pool.query(
            "UPDATE notifications_notifications SET read_at = NULL WHERE id = $1",
            [item.id],
          ),
          /notifications/,
        );
        assert.equal((await ok(a.call("GET", "/notifications"))).total, 1);
      });

      await t.test(
        "schedule events notify the assigned driver's account only",
        async () => {
          const a = await linkedDriver();
          const b = await linkedDriver();
          const bystander = await account("driver");
          const bus = await newBus();
          const route = await newRoute();
          const types = async (login) =>
            (await allFor(login.call))
              .filter(
                (i) =>
                  i.eventType.startsWith("schedule.") &&
                  i.entityId === schedule.id,
              )
              .map((i) => i.eventType);

          const schedule = await ok(
            manager.call("POST", "/schedules", {
              travelDate: day,
              departureTime: "10:00",
              arrivalTime: "14:00",
              busId: bus.id,
              driverId: a.driver.id,
              routeId: route.id,
            }),
            201,
          );
          await eventually(
            async () => (await types(a.login)).includes("schedule.assigned"),
            "assigned not delivered",
          );

          await ok(
            manager.call("PUT", `/schedules/${schedule.id}`, {
              arrivalTime: "15:00",
            }),
          );
          await eventually(
            async () => (await types(a.login)).includes("schedule.changed"),
            "changed not delivered",
          );

          await ok(
            manager.call("POST", `/schedules/${schedule.id}/replacement`, {
              driverId: b.driver.id,
            }),
          );
          await eventually(
            async () =>
              (await types(b.login)).includes("schedule.replacement_assigned"),
            "replacement not delivered",
          );

          await ok(manager.call("POST", `/schedules/${schedule.id}/cancel`));
          await eventually(
            async () => (await types(b.login)).includes("schedule.cancelled"),
            "cancelled not delivered",
          );

          assert.deepEqual((await types(a.login)).sort(), [
            "schedule.assigned",
            "schedule.changed",
          ]);
          assert.deepEqual((await types(b.login)).sort(), [
            "schedule.cancelled",
            "schedule.replacement_assigned",
          ]);
          assert.deepEqual(await types(bystander), []);
        },
      );

      await t.test(
        "a driver without a login account does not block the business operation",
        async () => {
          const driver = await newDriver(); // no linked account
          const schedule = await ok(
            manager.call("POST", "/schedules", {
              travelDate: addDays(day, 3),
              departureTime: "10:00",
              arrivalTime: "14:00",
              busId: (await newBus()).id,
              driverId: driver.id,
              routeId: (await newRoute()).id,
            }),
            201,
          );
          assert.equal(schedule.driverId, driver.id);
          await ok(manager.call("POST", `/schedules/${schedule.id}/cancel`));
        },
      );

      await t.test(
        "license and maintenance alerts reach Admin and Transportation Manager once",
        async () => {
          const adm = await account("admin");
          const plain = await account("driver");
          const expiring = await newDriver({
            licenseExpiryDate: addDays(today, 10),
          });
          const expired = await newDriver({
            licenseExpiryDate: addDays(today, -1),
          });
          const bus = await newBus();
          const record = (overrides) =>
            ok(
              manager.call("POST", "/maintenance", {
                busId: bus.id,
                serviceDate: addDays(today, -60),
                maintenanceType: "Oil change",
                workDescription: "Changed oil",
                cost: 100,
                ...overrides,
              }),
              201,
            );
          const overdue = await record({ nextServiceDate: addDays(today, -1) });
          const upcoming = await record({ nextServiceDate: addDays(today, 5) });
          created.records.push(overdue.id, upcoming.id);

          await runAlertCheck();
          const expected = [
            ["license.expiring", expiring.id],
            ["license.expired", expired.id],
            ["maintenance.overdue", overdue.id],
            ["maintenance.upcoming", upcoming.id],
          ];
          const count = (items, type, id) =>
            items.filter((i) => i.eventType === type && i.entityId === id)
              .length;
          for (const recipient of [adm, manager]) {
            const items = await allFor(recipient.call);
            for (const [type, id] of expected)
              assert.equal(count(items, type, id), 1, `${type} #${id}`);
          }
          assert.deepEqual(await allFor(plain.call), []);

          // Repeat-safe: a second run creates nothing new.
          await runAlertCheck();
          for (const recipient of [adm, manager]) {
            const items = await allFor(recipient.call);
            for (const [type, id] of expected)
              assert.equal(count(items, type, id), 1, `again ${type} #${id}`);
          }
        },
      );

      await t.test(
        "an applicant is notified of a status change, and only that applicant",
        async () => {
          const applicant = await account("applicant");
          const other = await account("applicant");
          const submitted = await ok(
            applicant.call("POST", "/recruitment/own", {
              fullName: "Applicant Notify",
              experience: "Five years driving heavy vehicles",
            }),
            201,
          );
          await ok(
            admin("PATCH", `/recruitment/${submitted.id}/status`, {
              status: "under_review",
            }),
          );
          await eventually(
            async () =>
              (await allFor(applicant.call)).some(
                (i) =>
                  i.eventType === "application.status_changed" &&
                  i.entityId === submitted.id,
              ),
            "status change not delivered",
          );
          const items = (await allFor(applicant.call)).filter(
            (i) => i.entityId === submitted.id,
          );
          assert.equal(items.length, 1);
          assert.match(items[0].message, /Under Review/);
          assert.deepEqual(await allFor(other.call), []);
        },
      );
    } finally {
      // Notifications are retained. Other records are never deleted: test data is
      // archived and accounts are deactivated.
      if (admin) {
        for (const id of created.records)
          await admin("POST", `/maintenance/${id}/archive`);
        for (const kind of ["buses", "drivers", "routes"]) {
          for (const id of created[kind])
            await admin("POST", `/${kind}/${id}/archive`);
        }
        for (const id of created.accounts)
          await admin("PATCH", `/accounts/${id}/status`, { isActive: false });
      }
      await new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
