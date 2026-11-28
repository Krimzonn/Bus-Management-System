// Maintenance API calls (Slice 10). Every request goes through the shared
// apiRequest, so session, CSRF and 401 handling are unchanged.
//
//   GET  /maintenance            ?q &archived &busId &serviceFrom &serviceTo &page &limit
//   GET  /maintenance/upcoming   ?busId &page &limit   -> adds asOf, upcomingThrough
//   GET  /maintenance/overdue    ?busId &page &limit   -> adds asOf
//   GET  /maintenance/bus/:busId ?q &archived &serviceFrom &serviceTo &page &limit
//                                -> { bus, items, page, limit, total }
//   GET  /maintenance/:id
//   POST /maintenance            { busId, serviceDate, maintenanceType, workDescription,
//                                  cost, odometer?, nextServiceDate? }
//   PUT  /maintenance/:id        any of the fields above except busId (null clears
//                                odometer / nextServiceDate)
//   POST /maintenance/:id/archive

import { apiRequest, listBuses } from "../../services/api.js";

function query(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

const id = (value) => encodeURIComponent(value);

export const listMaintenance = (filters) => apiRequest(`/maintenance${query(filters)}`);

export const listUpcomingMaintenance = (filters) =>
  apiRequest(`/maintenance/upcoming${query(filters)}`);

export const listOverdueMaintenance = (filters) =>
  apiRequest(`/maintenance/overdue${query(filters)}`);

export const getBusMaintenanceHistory = (busId, filters) =>
  apiRequest(`/maintenance/bus/${id(busId)}${query(filters)}`);

export const getMaintenance = (recordId) => apiRequest(`/maintenance/${id(recordId)}`);

export const createMaintenance = (input) =>
  apiRequest("/maintenance", { method: "POST", body: input });

export const updateMaintenance = (recordId, changes) =>
  apiRequest(`/maintenance/${id(recordId)}`, { method: "PUT", body: changes });

export const archiveMaintenance = (recordId) =>
  apiRequest(`/maintenance/${id(recordId)}/archive`, { method: "POST" });

// Reads every page of the bus list (the backend caps a page at 100 rows).
// archived: "false" | "true" | "all".
export async function fetchAllBuses(archived = "all") {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await listBuses({ archived, page: String(page), limit: "100" });
    items.push(...data.items);
    if (items.length >= data.total || data.items.length === 0) break;
  }
  return items;
}