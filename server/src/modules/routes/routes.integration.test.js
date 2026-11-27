import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";

const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;
const TEMP_PASSWORD = "Integration-Pass-123!";

async function openSession(base, userEmail, userPassword) {
  const csrfRes = await fetch(`${base}/auth/csrf`);
  const csrf = (await csrfRes.json()).data.csrfToken;
  let cookie = csrfRes.headers.getSetCookie()[0].split(";")[0];
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(loginRes.status, 200, `login failed for ${userEmail}`);
  cookie = loginRes.headers.getSetCookie()[0].split(";")[0];
  const token = (await loginRes.json()).data.csrfToken;
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
}

test("route lifecycle, availability, audit and role permissions over HTTP", { skip: !email || !password }, async () => {
  const server = app.listen(0);
  const createdAccountIds = [];
  let admin;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    admin = await openSession(base, email, password);

    const stamp = Date.now();
    async function sessionWithRole(role) {
      const userEmail = `it-routes-${role}-${stamp}@example.com`;
      const created = await admin("POST", "/accounts", { email: userEmail, password: TEMP_PASSWORD });
      assert.equal(created.status, 201);
      createdAccountIds.push(created.body.data.id);
      const assigned = await admin("PUT", `/accounts/${created.body.data.id}/role`, { role });
      assert.equal(assigned.status, 200);
      return openSession(base, userEmail, TEMP_PASSWORD);
    }

    // Unauthenticated access is rejected.
    assert.equal((await fetch(`${base}/routes`)).status, 401);
    assert.equal((await fetch(`${base}/routes/selectable`)).status, 401);

    // Admin lifecycle.
    const code = `IT-${stamp}`;
    const payload = { routeCode: code, name: "Integration Route", origin: "Origin", destination: "Destination" };
    const created = await admin("POST", "/routes", payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, "unblocked");
    const id = created.body.data.id;

    assert.equal((await admin("POST", "/routes", payload)).status, 409);
    assert.equal((await admin("POST", "/routes", { ...payload, routeCode: `${code}X`, name: "" })).body.code, "INVALID_ROUTE_NAME");
    assert.equal((await admin("POST", "/routes", { ...payload, routeCode: `${code}Y`, extra: 1 })).body.code, "INVALID_INPUT");
    assert.equal((await admin("GET", "/routes/abc")).body.code, "INVALID_ROUTE_ID");
    assert.equal((await admin("GET", "/routes/999999999")).status, 404);

    assert.equal((await admin("PUT", `/routes/${id}`, { destination: "New Destination" })).body.data.destination, "New Destination");
    assert.equal((await admin("PUT", `/routes/${id}`, { routeCode: "OTHER" })).body.code, "ROUTE_CODE_IMMUTABLE");
    assert.equal((await admin("PATCH", `/routes/${id}/status`, { status: "Blocked" })).body.code, "INVALID_ROUTE_STATUS");

    const selectable = async () => (await admin("GET", `/routes/selectable?q=${code}`)).body.data.items.length;
    assert.equal(await selectable(), 1);

    assert.equal((await admin("PATCH", `/routes/${id}/status`, { status: "blocked" })).body.data.status, "blocked");
    assert.equal(await selectable(), 0);
    assert.equal((await admin("GET", `/routes?q=${code}&status=blocked`)).body.data.items.length, 1);

    assert.equal((await admin("PATCH", `/routes/${id}/status`, { status: "unblocked" })).status, 200);
    assert.equal(await selectable(), 1);

    assert.equal((await admin("POST", `/routes/${id}/archive`)).status, 200);
    assert.equal(await selectable(), 0);
    assert.equal((await admin("GET", `/routes?q=${code}`)).body.data.items.length, 0);
    const kept = await admin("GET", `/routes/${id}`);
    assert.equal(kept.status, 200);
    assert.equal(kept.body.data.isArchived, true);
    assert.equal((await admin("GET", `/routes?q=${code}&archived=all`)).body.data.items.length, 1);
    assert.equal((await admin("PUT", `/routes/${id}`, { name: "Nope" })).body.code, "ROUTE_ARCHIVED");
    assert.equal((await admin("PATCH", `/routes/${id}/status`, { status: "blocked" })).body.code, "ROUTE_ARCHIVED");
    assert.equal((await admin("POST", `/routes/${id}/archive`)).body.code, "ROUTE_ALREADY_ARCHIVED");
    assert.equal((await admin("POST", "/routes", payload)).body.code, "ROUTE_ALREADY_EXISTS");
    assert.equal((await admin("GET", "/routes/selectable?status=blocked")).body.code, "INVALID_ROUTE_FILTER");

    // Audit trail written for every mutation.
    const audit = await admin("GET", `/audit?entityType=route&entityId=${id}`);
    assert.equal(audit.status, 200);
    const actions = audit.body.data.items.map((entry) => entry.action);
    for (const expected of ["route.created", "route.updated", "route.status_changed", "route.archived"]) {
      assert.ok(actions.includes(expected), `missing audit action ${expected}`);
    }

    // Role permissions.
    const manager = await sessionWithRole("transportation_manager");
    const managerRoute = await manager("POST", "/routes", { ...payload, routeCode: `${code}-M` });
    assert.equal(managerRoute.status, 201);
    assert.equal((await manager("PATCH", `/routes/${managerRoute.body.data.id}/status`, { status: "blocked" })).status, 200);
    assert.equal((await manager("POST", `/routes/${managerRoute.body.data.id}/archive`)).status, 200);

    const staff = await sessionWithRole("administrative_staff");
    assert.equal((await staff("GET", "/routes")).status, 200);
    assert.equal((await staff("GET", "/routes/selectable")).status, 200);
    assert.equal((await staff("GET", `/routes/${id}`)).status, 200);
    for (const [method, path, body] of [
      ["POST", "/routes", { ...payload, routeCode: `${code}-S` }],
      ["PUT", `/routes/${id}`, { name: "Nope" }],
      ["PATCH", `/routes/${id}/status`, { status: "blocked" }],
      ["POST", `/routes/${id}/archive`, undefined],
    ]) {
      const res = await staff(method, path, body);
      assert.equal(res.status, 403, `${method} ${path} should be 403 for administrative_staff`);
      assert.equal(res.body.code, "INSUFFICIENT_PERMISSION");
    }

    const driver = await sessionWithRole("driver");
    assert.equal((await driver("GET", "/routes")).status, 403);
    assert.equal((await driver("GET", "/routes/selectable")).status, 403);
    assert.equal((await driver("POST", "/routes", { ...payload, routeCode: `${code}-D` })).status, 403);
  } finally {
    if (admin) {
      for (const accountId of createdAccountIds) {
        await admin("PATCH", `/accounts/${accountId}/status`, { isActive: false });
      }
    }
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});