import { pool } from "../../database/db.js";
import { businessToday } from "../../utils/business-date.js";
import { classifyLicense, expiryWindowEnd } from "./license.js";
import { parseDriverId } from "./validation.js";

// Public read-only interface for the notification wiring.

// The login account linked to a driver RECORD, or null. A driver id and an account
// id are different things and must never be used interchangeably.
export async function getAccountIdForDriver(driverId, executor = pool) {
  const result = await executor.query(
    "SELECT account_user_id FROM drivers_drivers WHERE id = $1",
    [parseDriverId(String(driverId))],
  );
  const value = result.rows[0]?.account_user_id;
  return value == null ? null : String(value);
}

// Drivers that are not archived and whose license is expired or expires within the
// 30-day window (FR-LIC-02, today and the 30th day included), on the business date.
export async function listLicenseAlerts(
  executor = pool,
  today = businessToday(),
) {
  const result = await executor.query(
    `SELECT id, full_name, to_char(license_expiry_date, 'YYYY-MM-DD') AS license_expiry_date
     FROM drivers_drivers
     WHERE is_archived = FALSE AND license_expiry_date <= $1::date
     ORDER BY license_expiry_date ASC, id ASC`,
    [expiryWindowEnd(today)],
  );
  return result.rows
    .map((row) => ({
      driverId: String(row.id),
      fullName: row.full_name,
      licenseExpiryDate: row.license_expiry_date,
      state: classifyLicense(row.license_expiry_date, today),
    }))
    .filter((alert) => alert.state !== "valid");
}
