import { businessToday } from "../../utils/business-date.js";
import { pool } from "../../database/db.js";
import { withTransaction } from "../../database/transaction.js";
import { recordStrict } from "../audit/writer.js";
import { createDriver, getDriverIdForAccount } from "../drivers/index.js";
import {
  application,
  error,
  id,
  interview,
  listFilters,
  object,
  string,
  transition,
} from "./validation.js";
const columns = `id, applicant_id, applicant_email, full_name, experience, status, to_char(interview_date,'YYYY-MM-DD') AS interview_date, interview_notes, interview_outcome, decision_reason, driver_id, created_at, updated_at`;
async function history(client, row, user, event, before, details = {}) {
  await client.query(
    "INSERT INTO recruitment_history(application_id,actor_id,event,previous_status,new_status,details) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      row.id,
      user.id,
      event,
      before?.status ?? null,
      row.status,
      JSON.stringify(details),
    ],
  );
  await recordStrict(client, {
    actorId: user.id,
    actorEmail: user.email,
    action: `recruitment.${event}`,
    entityType: "application",
    entityId: row.id,
    before: before
      ? {
          status: before.status,
          ...(event === "interview_recorded"
            ? {
                interviewDate: before.interview_date,
                outcome: before.interview_outcome,
                notes: before.interview_notes,
              }
            : event === "status_changed"
              ? { decisionReason: before.decision_reason }
              : event === "driver_registered"
                ? { driverId: before.driver_id }
                : {}),
        }
      : null,
    after: { status: row.status, ...details },
  });
}
async function find(client, applicationId, owner, lock = false) {
  const r = await client.query(
    `SELECT ${columns} FROM recruitment_applications WHERE id=$1${owner ? " AND applicant_id=$2" : ""}${lock ? " FOR UPDATE" : ""}`,
    owner ? [id(applicationId), owner] : [id(applicationId)],
  );
  if (!r.rows.length) throw error("APPLICATION_NOT_FOUND", 404);
  return r.rows[0];
}
export async function listApplications(owner = null, query = {}) {
  if (owner) {
    const r = await pool.query(
      `SELECT ${columns} FROM recruitment_applications WHERE applicant_id=$1 ORDER BY id DESC`,
      [owner],
    );
    return r.rows;
  }
  const { q, status, page, limit } = listFilters(query);
  const r = await pool.query(
    `SELECT ${columns} FROM recruitment_applications WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR strpos(lower(full_name || ' ' || applicant_email || ' ' || id::text),lower($2))>0) ORDER BY id DESC LIMIT $3 OFFSET $4`,
    [status, q, limit + 1, (page - 1) * limit],
  );
  return {
    items: r.rows.slice(0, limit),
    page,
    limit,
    hasMore: r.rows.length > limit,
  };
}
export async function getApplication(applicationId, owner = null) {
  // One query provides a consistent snapshot of the current application and history.
  const r = await pool.query(
    `SELECT ${columns}, COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id::text,'event',h.event,'previous_status',h.previous_status,'new_status',h.new_status,'details',h.details,'created_at',h.created_at) ORDER BY h.id) FROM recruitment_history h WHERE h.application_id=recruitment_applications.id),'[]'::jsonb) AS history FROM recruitment_applications WHERE id=$1${owner ? " AND applicant_id=$2" : ""}`,
    owner ? [id(applicationId), owner] : [id(applicationId)],
  );
  if (!r.rows.length) throw error("APPLICATION_NOT_FOUND", 404);
  return r.rows[0];
}
export async function submit(input, user) {
  const { fullName, experience } = application(input);
  try {
    return await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO recruitment_applications(applicant_id,applicant_email,full_name,experience) VALUES ($1,$2,$3,$4) RETURNING ${columns}`,
        [user.id, user.email, fullName, experience],
      );
      const row = r.rows[0];
      await history(client, row, user, "submitted", null);
      return row;
    });
  } catch (e) {
    if (e.code === "23505") throw error("DUPLICATE_APPLICATION", 409);
    throw e;
  }
}
export async function changeStatus(applicationId, input, user) {
  const { status, reason } = object(input, ["status", "reason"]);
  const decisionReason = string(reason, 255, false);
  if (!["selected", "rejected"].includes(status) && decisionReason !== null)
    throw error("INVALID_RECRUITMENT_INPUT");
  return withTransaction(async (client) => {
    const before = await find(client, applicationId, null, true);
    transition(before.status, status, before.interview_outcome);
    const r = await client.query(
      `UPDATE recruitment_applications SET status=$2,decision_reason=$3,updated_at=now() WHERE id=$1 RETURNING ${columns}`,
      [before.id, status, decisionReason],
    );
    const row = r.rows[0];
    await history(client, row, user, "status_changed", before, {
      decisionReason,
    });
    return row;
  });
}
export async function recordInterview(applicationId, input, user) {
  const { date, notes, outcome } = interview(input, businessToday());
  return withTransaction(async (client) => {
    const before = await find(client, applicationId, null, true);
    if (before.status !== "test_interview")
      throw error("INVALID_APPLICATION_TRANSITION", 409);
    if (before.interview_outcome && outcome === null)
      throw error("INVALID_APPLICATION_TRANSITION", 409);
    const r = await client.query(
      `UPDATE recruitment_applications SET interview_date=$2,interview_notes=$3,interview_outcome=$4,updated_at=now() WHERE id=$1 RETURNING ${columns}`,
      [before.id, date, notes, outcome],
    );
    const row = r.rows[0];
    await history(client, row, user, "interview_recorded", before, {
      interviewDate: date,
      notes,
      outcome,
    });
    return row;
  });
}
export async function registerDriver(applicationId, input, user) {
  const fields = object(input, [
    "licenseNumber",
    "licenseCategory",
    "licenseExpiryDate",
  ]);
  return withTransaction(async (client) => {
    const before = await find(client, applicationId, user.id, true);
    if (before.status !== "selected")
      throw error("DRIVER_REGISTRATION_NOT_ELIGIBLE", 409);
    if (before.driver_id || (await getDriverIdForAccount(user.id, client)))
      throw error("DRIVER_ALREADY_REGISTERED", 409);
    const driver = await createDriver({
      input: { ...fields, fullName: before.full_name },
      actorId: user.id,
      actorEmail: user.email,
      transaction: client,
    });
    const r = await client.query(
      `UPDATE recruitment_applications SET driver_id=$2,updated_at=now() WHERE id=$1 RETURNING ${columns}`,
      [before.id, driver.id],
    );
    await history(client, r.rows[0], user, "driver_registered", before, {
      driverId: driver.id,
    });
    return r.rows[0];
  });
}
