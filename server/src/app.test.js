import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import app from "./app.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);

  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  baseUrl = `http://localhost:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

describe("API tests", () => {
  it("should return the API welcome message", async () => {
    const response = await fetch(`${baseUrl}/`);

    assert.equal(response.status, 200);

    const data = await response.json();

    assert.equal(data.message, "Bus Management System API is running.");
    assert.equal(data.success, true);
    assert.equal(data.data, null);
  });

  it("should return 404 for an unknown route", async () => {
    const response = await fetch(`${baseUrl}/invalid`);

    assert.equal(response.status, 404);

    const data = await response.json();

    assert.equal(data.message, "Route not found.");
  });

  it("should return a healthy database status", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);

    assert.equal(response.status, 200);

    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.data.status, "healthy");
    assert.equal(data.data.database, "connected");
  });
});
