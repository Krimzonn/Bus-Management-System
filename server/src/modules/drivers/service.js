import { pool } from "../../database/db.js";
import {
  withTransaction,
  isActiveTransaction,
} from "../../database/transaction.js";
import { businessToday } from "../../utils/business-date.js";
import { recordStrict } from "../audit/writer.js";
import { classifyLicense, expiryWindowEnd } from "./license.js";
import {
  driverError,
  LICENSE_SEPARATORS,
  parseCreateInput,
  parseDriverId,
  parseExpiryFilters,
  parseLicenseCategory,
  parseListFilters,
  parseStatusInput,
  parseTripDate,
  parseUpdateInput,
} from "./validation.js";

const TABLE = "drivers_drivers";
const LICENSE_CONSTRAINT = "drivers_drivers_license_key";
// The expiry date is read as text: node-postgres would otherwise turn a DATE into
// a local-midnight timestamp, which can shift it by a day.
const COLUMNS = `id, full_name, license_number, license_category,
  to_char(license_expiry_date, 'YYYY-MM-DD') AS license_expiry_date,
  status, is_archived, archived_at, created_at, updated_at`;
const SELECT_DRIVER = `SELECT ${COLUMNS} FROM ${TABLE}`;
const PROFILE_COLUMNS = { fullName: "full_name" };
const LICENSE_COLUMNS = {
  licenseNumber: "license_number",
  licenseCategory: "license_category",
  licenseExpiryDate: "license_expiry_date",
};
const UPDATABLE = { ...PROFILE_COLUMNS, ...LICENSE_COLUMNS };
const CREATED_FIELDS = [
  "fullName",
  "licenseNumber",
  "licenseCategory",
  "licenseExpiryDate",
  "status",
  "isArchived",
];

function toDriver(row, today = businessToday()) {
  const licenseStatus = classifyLicense(row.license_expiry_date, today);
  return {
    id: String(row.id),
    fullName: row.full_name,
    licenseNumber: row.license_number,
    licenseCategory: row.license_category,
    licenseExpiryDate: row.license_expiry_date,
    licenseStatus,
    isLicenseValid: licenseStatus !== "expired",
    status: row.status,
    isArchived: row.is_archived,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pick(driver, keys) {
  return Object.fromEntries(keys.map((key) => [key, driver[key]]));
}

function mapWriteError(error) {
  if (error.code === "23505" && error.constraint === LICENSE_CONSTRAINT) {
    return driverError("DRIVER_LICENSE_ALREADY_EXISTS", 409);
  }
  return error;
}

async function lockDriver(client, id) {
  const result = await client.query(
    `${SELECT_DRIVER} WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!result.rows.length) throw driverError("DRIVER_NOT_FOUND", 404);
  return toDriver(result.rows[0]);
}

function assertNotArchived(driver) {
  if (driver.isArchived) throw driverError("DRIVER_ARCHIVED", 409);
}

export async function createDriver({
  input,
  actorId,
  actorEmail,
  transaction,
}) {
  const driver = parseCreateInput(input);
  try {
    const operation = async (client) => {
      const result = await client.query(
        `INSERT INTO ${TABLE}
           (full_name, license_number, license_category, license_expiry_date, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [
          driver.fullName,
          driver.licenseNumber,
          driver.licenseCategory,
          driver.licenseExpiryDate,
          driver.status,
        ],
      );
      const created = toDriver(result.rows[0]);
      await recordStrict(client, {
        actorId,
        actorEmail,
        action: "driver.created",
        entityType: "driver",
        entityId: created.id,
        before: null,
        after: pick(created, CREATED_FIELDS),
      });
      return created;
    };
    if (transaction && !isActiveTransaction(transaction))
      throw new Error("DRIVER_TRANSACTION_REQUIRED");
    return transaction
      ? await operation(transaction)
      : await withTransaction(operation);
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function getDriver(id) {
  const result = await pool.query(`${SELECT_DRIVER} WHERE id = $1`, [
    parseDriverId(id),
  ]);
  if (!result.rows.length) throw driverError("DRIVER_NOT_FOUND", 404);
  return toDriver(result.rows[0]);
}

const escapeLike = (value) => value.replace(/[\\%_]/g, "\\$&");

async function queryDrivers(filters, today, orderBy) {
  const clauses = [];
  const values = [];
  const param = (value) => `$${values.push(value)}`;

  if (filters.archived !== "all")
    clauses.push(`is_archived = ${param(filters.archived === "true")}`);
  if (filters.status) clauses.push(`status = ${param(filters.status)}`);
  if (filters.licenseCategory)
    clauses.push(`license_category = ${param(filters.licenseCategory)}`);
  if (filters.licenseStatus === "expired") {
    clauses.push(`license_expiry_date < ${param(today)}::date`);
  } else if (filters.licenseStatus) {
    // "valid" and "expiring_soon" both start today, so neither includes expired rows.
    clauses.push(`license_expiry_date >= ${param(today)}::date`);
    if (filters.licenseStatus === "expiring_soon") {
      clauses.push(
        `license_expiry_date <= ${param(expiryWindowEnd(today))}::date`,
      );
    }
  }
  if (filters.q) {
    // Escape LIKE wildcards so the search term is always literal.
    const matches = [
      `full_name ILIKE ${param(`%${escapeLike(filters.q)}%`)} ESCAPE '\\'`,
    ];
    const licenseKey = filters.q.toUpperCase().replace(LICENSE_SEPARATORS, "");
    if (licenseKey) {
      matches.push(
        `translate(license_number, ' -/', '') LIKE ${param(`%${escapeLike(licenseKey)}%`)} ESCAPE '\\'`,
      );
    }
    clauses.push(`(${matches.join(" OR ")})`);
  }

  const limit = param(filters.limit);
  const offset = param((filters.page - 1) * filters.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${COLUMNS}, COUNT(*) OVER() AS total_count
     FROM ${TABLE} ${where}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    items: result.rows.map((row) => toDriver(row, today)),
    page: filters.page,
    limit: filters.limit,
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
  };
}

export async function listDrivers(query) {
  return queryDrivers(
    parseListFilters(query),
    businessToday(),
    "full_name ASC, id ASC",
  );
}

// License expiry monitoring for drivers that are not archived, soonest first.
export async function listLicenseExpiry(query) {
  const filters = parseExpiryFilters(query);
  const today = businessToday();
  // Table-qualified so the DATE column is sorted, not the text output column.
  const page = await queryDrivers(
    filters,
    today,
    `${TABLE}.license_expiry_date ASC, id ASC`,
  );
  return {
    state: filters.licenseStatus,
    asOf: today,
    expiringSoonThrough: expiryWindowEnd(today),
    ...page,
  };
}

// Profile and license changes are audited as separate events in one transaction.
export async function updateDriver({ id, input, actorId, actorEmail }) {
  const driverId = parseDriverId(id);
  const changes = parseUpdateInput(input);

  try {
    return await withTransaction(async (client) => {
      const before = await lockDriver(client, driverId);
      assertNotArchived(before);
      const keys = Object.keys(UPDATABLE).filter(
        (key) => changes[key] !== undefined && changes[key] !== before[key],
      );
      if (!keys.length) return before;

      const values = keys.map((key) => changes[key]);
      values.push(driverId);
      const result = await client.query(
        `UPDATE ${TABLE}
         SET ${keys.map((key, i) => `${UPDATABLE[key]} = $${i + 1}`).join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $${values.length} RETURNING ${COLUMNS}`,
        values,
      );
      const after = toDriver(result.rows[0]);
      for (const [action, columns] of [
        ["driver.updated", PROFILE_COLUMNS],
        ["driver.license_updated", LICENSE_COLUMNS],
      ]) {
        const changed = keys.filter((key) => Object.hasOwn(columns, key));
        if (!changed.length) continue;
        await recordStrict(client, {
          actorId,
          actorEmail,
          action,
          entityType: "driver",
          entityId: driverId,
          before: pick(before, changed),
          after: pick(after, changed),
        });
      }
      return after;
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function setDriverStatus({ id, input, actorId, actorEmail }) {
  const driverId = parseDriverId(id);
  const status = parseStatusInput(input);

  return withTransaction(async (client) => {
    const before = await lockDriver(client, driverId);
    assertNotArchived(before);
    if (before.status === status) return before;
    const result = await client.query(
      `UPDATE ${TABLE} SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING ${COLUMNS}`,
      [status, driverId],
    );
    const after = toDriver(result.rows[0]);
    await recordStrict(client, {
      actorId,
      actorEmail,
      action: "driver.status_changed",
      entityType: "driver",
      entityId: driverId,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

// Archive, never delete: the row and every reference to it are kept.
export async function archiveDriver({ id, actorId, actorEmail }) {
  const driverId = parseDriverId(id);

  return withTransaction(async (client) => {
    const before = await lockDriver(client, driverId);
    if (before.isArchived) throw driverError("DRIVER_ALREADY_ARCHIVED", 409);
    const result = await client.query(
      `UPDATE ${TABLE}
       SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [driverId],
    );
    const after = toDriver(result.rows[0]);
    await recordStrict(client, {
      actorId,
      actorEmail,
      action: "driver.archived",
      entityType: "driver",
      entityId: driverId,
      before: { isArchived: false },
      after: { isArchived: true },
    });
    return after;
  });
}

const ineligible = (reason) => ({ eligible: false, reason });

// Public read-only eligibility interface for Scheduling (BR-02, BR-13).
// The license is checked on the trip date, never on today's date. Fails closed,
// reports the first failing rule and returns no driver data.
export function evaluateDriverEligibility(
  driver,
  { tripDate, requiredLicenseCategory } = {},
) {
  const date = parseTripDate(tripDate);
  const category = parseLicenseCategory(requiredLicenseCategory);

  if (!driver) return ineligible("DRIVER_NOT_FOUND");
  if (driver.isArchived !== false) return ineligible("DRIVER_ARCHIVED");
  if (driver.status === "on_leave") return ineligible("DRIVER_ON_LEAVE");
  if (driver.status === "absent") return ineligible("DRIVER_ABSENT");
  if (driver.status !== "available") return ineligible("DRIVER_UNAVAILABLE");
  // Negated so that a missing expiry date is also treated as expired.
  if (!(driver.licenseExpiryDate >= date)) return ineligible("LICENSE_EXPIRED");
  if (driver.licenseCategory !== category)
    return ineligible("LICENSE_CATEGORY_MISMATCH");
  return { eligible: true, reason: null };
}

// `executor` lets Scheduling pass its own transaction client; defaults to the pool.
export async function getDriverAssignmentEligibility(
  id,
  requirements,
  executor = pool,
) {
  const result = await executor.query(`${SELECT_DRIVER} WHERE id = $1`, [
    parseDriverId(id),
  ]);
  return evaluateDriverEligibility(
    result.rows.length ? toDriver(result.rows[0]) : null,
    requirements,
  );
}

// Holds a share lock on the driver until the caller's transaction ends, so the
// status, license or archival cannot change between a check and the write.
export async function lockDriverForAssignment(id, executor) {
  await executor.query(`SELECT id FROM ${TABLE} WHERE id = $1 FOR SHARE`, [
    parseDriverId(id),
  ]);
}

// Minimal display data (no license details), including archived drivers.
export async function getDriverSummaries(ids, executor = pool) {
  if (!ids.length) return [];
  const result = await executor.query(
    `SELECT id, full_name FROM ${TABLE} WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    fullName: row.full_name,
  }));
}

// The driver record linked to a login account, or null.
export async function getDriverIdForAccount(userId, executor = pool) {
  const result = await executor.query(
    `SELECT id FROM ${TABLE} WHERE account_user_id = $1`,
    [userId],
  );
  return result.rows.length ? String(result.rows[0].id) : null;
}

async function readAccountLink(executor, driverId, lock = "") {
  const result = await executor.query(
    `SELECT account_user_id, is_archived FROM ${TABLE} WHERE id = $1 ${lock}`,
    [driverId],
  );
  if (!result.rows.length) throw driverError("DRIVER_NOT_FOUND", 404);
  const row = result.rows[0];
  return {
    userId: row.account_user_id == null ? null : String(row.account_user_id),
    isArchived: row.is_archived,
  };
}

export async function getDriverAccountLink(id) {
  const driverId = parseDriverId(id);
  const { userId } = await readAccountLink(pool, driverId);
  return { driverId, userId };
}

// Links (or, with null, unlinks) a login account. The caller must already have
// verified the account through Identity & Access.
export async function setDriverAccountLink({
  id,
  userId,
  actorId,
  actorEmail,
}) {
  const driverId = parseDriverId(id);

  try {
    return await withTransaction(async (client) => {
      const before = await readAccountLink(client, driverId, "FOR UPDATE");
      if (before.userId === userId) return { driverId, userId };
      // An archived driver can be unlinked but not given a new account.
      if (userId !== null) assertNotArchived(before);
      await client.query(
        `UPDATE ${TABLE} SET account_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [userId, driverId],
      );
      await recordStrict(client, {
        actorId,
        actorEmail,
        action: "driver.account_link_changed",
        entityType: "driver",
        entityId: driverId,
        before: { accountUserId: before.userId },
        after: { accountUserId: userId },
      });
      return { driverId, userId };
    });
  } catch (error) {
    if (
      error.code === "23505" &&
      error.constraint === "drivers_drivers_account_key"
    ) {
      throw driverError("DRIVER_ACCOUNT_ALREADY_LINKED", 409);
    }
    throw error;
  }
}
