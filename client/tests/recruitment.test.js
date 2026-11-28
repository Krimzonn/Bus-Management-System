import test from "node:test";
import assert from "node:assert/strict";
import {
  registerApplicant,
  listRecruitment,
  getRecruitment,
  submitRecruitment,
  changeRecruitmentStatus,
  saveRecruitmentInterview,
  registerRecruitmentDriver,
  setCsrfToken,
} from "../src/services/api.js";
import {
  workflowSteps,
  recruitmentActions,
} from "../src/features/recruitment/recruitmentModel.js";
import { CAPABILITIES, can } from "../src/utils/permissions.js";
test("recruitment requests use shared session API, CSRF, exact route and payload contracts", async (t) => {
  const calls = [];
  setCsrfToken("test-token");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return {
      ok: true,
      json: async () => ({ success: true, data: { id: "9" } }),
    };
  });
  const input = { email: "a@example.com", password: "Password-1234" };
  await registerApplicant(input);
  await listRecruitment(true);
  await listRecruitment(false, { q: "Ali Raza", status: "submitted", page: 2 });
  await getRecruitment(true, "9");
  await getRecruitment(false, "9");
  await submitRecruitment({ fullName: "Ali", experience: "10 years" });
  await changeRecruitmentStatus("9", { status: "under_review" });
  await saveRecruitmentInterview("9", {
    date: "2026-01-01",
    notes: "Interview",
    outcome: "passed",
  });
  await registerRecruitmentDriver("9", {
    licenseNumber: "A-1",
    licenseCategory: "HTV",
    licenseExpiryDate: "2099-01-01",
  });
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["POST", "/api/v1/auth/register-applicant"],
      ["GET", "/api/v1/recruitment/own"],
      ["GET", "/api/v1/recruitment?q=Ali+Raza&status=submitted&page=2"],
      ["GET", "/api/v1/recruitment/own/9"],
      ["GET", "/api/v1/recruitment/9"],
      ["POST", "/api/v1/recruitment/own"],
      ["PATCH", "/api/v1/recruitment/9/status"],
      ["PUT", "/api/v1/recruitment/9/interview"],
      ["POST", "/api/v1/recruitment/own/9/driver"],
    ],
  );
  for (const call of calls) {
    assert.equal(call.credentials, "include");
    assert.equal(call.headers["X-CSRF-Token"], "test-token");
  }
  assert.deepEqual(JSON.parse(calls[0].body), input);
  assert.deepEqual(JSON.parse(calls[6].body), { status: "under_review" });
  assert.ok(!("fullName" in JSON.parse(calls[8].body)));
  setCsrfToken(null);
});
test("workflow timeline and action hints for each major state", () => {
  assert.deepEqual(
    workflowSteps("under_review").map((x) => x.state),
    ["done", "current", "pending", "pending"],
  );
  assert.equal(workflowSteps("rejected").at(-1).label, "Rejected");
  assert.equal(workflowSteps("selected").at(-1).state, "current");
  const admin = { manage: true, own: false },
    applicant = { manage: false, own: true };
  assert.equal(
    recruitmentActions({ status: "submitted" }, admin).beginReview,
    true,
  );
  assert.equal(
    recruitmentActions({ status: "under_review" }, admin).beginInterview,
    true,
  );
  assert.equal(
    recruitmentActions({ status: "test_interview" }, admin).recordInterview,
    true,
  );
  assert.equal(
    recruitmentActions({ status: "test_interview" }, admin).finalize,
    false,
  );
  assert.equal(
    recruitmentActions(
      { status: "test_interview", interview_outcome: "passed" },
      admin,
    ).finalize,
    true,
  );
  assert.equal(
    recruitmentActions({ status: "selected" }, applicant).registerDriver,
    true,
  );
  assert.equal(
    recruitmentActions({ status: "selected", driver_id: "1" }, applicant)
      .registerDriver,
    false,
  );
  assert.equal(
    recruitmentActions({ status: "rejected" }, applicant).registerDriver,
    false,
  );
  assert.equal(
    recruitmentActions({ status: "submitted" }, applicant).beginReview,
    false,
  );
});
test("frontend permission hints match the Slice 9 matrix", () => {
  assert.equal(
    can({ role: "applicant" }, CAPABILITIES.APPLY_RECRUITMENT),
    true,
  );
  assert.equal(
    can({ role: "applicant" }, CAPABILITIES.VIEW_RECRUITMENT),
    false,
  );
  assert.equal(can({ role: "admin" }, CAPABILITIES.MANAGE_RECRUITMENT), true);
  assert.equal(
    can({ role: "transportation_manager" }, CAPABILITIES.VIEW_RECRUITMENT),
    true,
  );
  assert.equal(
    can({ role: "transportation_manager" }, CAPABILITIES.MANAGE_RECRUITMENT),
    false,
  );
  assert.equal(can({ role: "driver" }, CAPABILITIES.VIEW_RECRUITMENT), false);
});
