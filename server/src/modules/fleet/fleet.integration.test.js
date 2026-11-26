import test from "node:test";
import assert from "node:assert/strict";
import app from "../../app.js";

// Needs a migrated database and an Admin account (same variables as auth.integration.test.js).
const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;

test("bus lifecycle over HTTP", { skip: !email || !password }, async () => {
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const csrfRes = await fetch(`${base}/auth/csrf`);
    const csrf = (await csrfRes.json()).data.csrfToken;
    let cookie = csrfRes.headers.getSetCookie()[0].split(";")[0];
    const loginRes = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    cookie = loginRes.headers.getSetCookie()[0].split(";")[0];
    const token = (await loginRes.json()).data.csrfToken;

    const call = async (method, path, body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    const unauth = await fetch(`${base}/buses`);
    assert.equal(unauth.status, 401);

    const number = `IT-${Date.now()}`;
    const payload = { busNumber: number, seatingCapacity: 40, requiredLicenseCategory: "HTV" };

    const created = await call("POST", "/buses", payload);
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    assert.equal((await call("POST", "/buses", payload)).status, 409);
    assert.equal((await call("POST", "/buses", { ...payload, busNumber: `${number}X`, seatingCapacity: 101 })).body.code, "INVALID_SEATING_CAPACITY");
    assert.equal((await call("PUT", `/buses/${id}`, { seatingCapacity: 45 })).body.data.seatingCapacity, 45);
    assert.equal((await call("PATCH", `/buses/${id}/status`, { status: "inactive" })).body.data.status, "inactive");

    const listed = await call("GET", `/buses?q=${number}`);
    assert.equal(listed.body.data.items.length, 1);

    assert.equal((await call("POST", `/buses/${id}/archive`)).status, 200);
    assert.equal((await call("GET", `/buses?q=${number}`)).body.data.items.length, 0);
    assert.equal((await call("GET", `/buses?q=${number}&archived=all`)).body.data.items.length, 1);
    assert.equal((await call("PUT", `/buses/${id}`, { seatingCapacity: 30 })).body.code, "BUS_ARCHIVED");
    // An archived bus number can never be reused.
    assert.equal((await call("POST", "/buses", payload)).body.code, "BUS_ALREADY_EXISTS");
  } finally {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});