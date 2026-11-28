import { pool } from "../../database/db.js";
import { evaluateDriverEligibility } from "./service.js";
import { parseDriverId, parseLicenseCategory, parseTripDate } from "./validation.js";

// Slice 8: public read-only interface for Scheduling (replacement suggestions).
// Reuses evaluateDriverEligibility, so a suggestion follows exactly the rules the
// final assignment check applies (BR-02, BR-13, BR-04). Archived drivers are
// never read. Overlapping trips are Scheduling's concern, not Drivers'.
// The result is advisory: Scheduling rechecks everything when it saves.
//
// funnel counts are cumulative: evaluated >= available >= licenseValid >=
// categoryQualified, so an empty result can be explained.
const NOT_AVAILABLE = new Set([
  "DRIVER_ON_LEAVE", "DRIVER_ABSENT", "DRIVER_UNAVAILABLE", "DRIVER_ARCHIVED",
]);

export async function listReplacementCandidates(
  { tripDate, requiredLicenseCategory, excludeDriverId = null },
  executor = pool,
) {
  const requirements = {
    tripDate: parseTripDate(tripDate),
    requiredLicenseCategory: parseLicenseCategory(requiredLicenseCategory),
  };
  const exclude = excludeDriverId == null ? null : parseDriverId(String(excludeDriverId));

  const result = await executor.query(
    `SELECT id, full_name, license_category,
            to_char(license_expiry_date, 'YYYY-MM-DD') AS license_expiry_date,
            status, is_archived
     FROM drivers_drivers
     WHERE is_archived = FALSE AND ($1::bigint IS NULL OR id <> $1::bigint)
     ORDER BY full_name ASC, id ASC`,
    [exclude],
  );

  const funnel = { evaluated: result.rows.length, available: 0, licenseValid: 0, categoryQualified: 0 };
  const candidates = [];
  for (const row of result.rows) {
    const { reason } = evaluateDriverEligibility({
      status: row.status,
      isArchived: row.is_archived,
      licenseCategory: row.license_category,
      licenseExpiryDate: row.license_expiry_date,
    }, requirements);
    if (NOT_AVAILABLE.has(reason)) continue;
    funnel.available += 1;
    if (reason === "LICENSE_EXPIRED") continue;
    funnel.licenseValid += 1;
    if (reason !== null) continue;
    funnel.categoryQualified += 1;
    candidates.push({
      id: String(row.id),
      fullName: row.full_name,
      licenseCategory: row.license_category,
      licenseExpiryDate: row.license_expiry_date,
    });
  }
  return { candidates, funnel };
}