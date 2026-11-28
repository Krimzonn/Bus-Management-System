import { pool } from "../../database/db.js";
import { businessToday } from "../../utils/business-date.js";
import { classifyMaintenanceDue } from "./maintenance-service.js";

// Public read-only interface for the notification wiring. Active (not archived)
// maintenance records of buses that are not archived whose next service date is
// overdue (before today) or upcoming (today through today + 30 days, BR-12 /
// Slice 10). Due today is upcoming, never overdue.
export async function listMaintenanceDueAlerts(
  executor = pool,
  today = businessToday(),
) {
  const result = await executor.query(
    `SELECT m.id, b.bus_number, m.maintenance_type,
            to_char(m.next_service_date, 'YYYY-MM-DD') AS next_service_date
     FROM fleet_maintenance_records m
     JOIN fleet_buses b ON b.id = m.bus_id
     WHERE m.archived_at IS NULL AND b.is_archived = FALSE
       AND m.next_service_date IS NOT NULL
       AND m.next_service_date <= ($1::date + 30)
     ORDER BY m.next_service_date ASC, m.id ASC`,
    [today],
  );
  return result.rows
    .map((row) => ({
      recordId: String(row.id),
      busNumber: row.bus_number,
      maintenanceType: row.maintenance_type,
      nextServiceDate: row.next_service_date,
      status: classifyMaintenanceDue(row.next_service_date, today, false),
    }))
    .filter((alert) => alert.status !== "none");
}
