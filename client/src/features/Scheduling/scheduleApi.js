// Schedule API calls (Slice 7). All requests go through the shared apiRequest,
// so session, CSRF and 401 handling are unchanged.
//
// Management (view-schedules / manage-schedules):
//   GET  /schedules          ?dateFrom &dateTo &status &busId &driverId &routeId &page &limit
//                            -> { items, page, limit, total }
//   GET  /schedules/:id
//   POST /schedules          { travelDate, departureTime, arrivalTime, busId, driverId?, routeId? }
//   PUT  /schedules/:id      any of the same fields (only while status is "scheduled")
//   POST /schedules/:id/start | /complete | /cancel
// Driver (view-own-trips / operate-own-trips):
//   GET  /schedules/mine     ?dateFrom &dateTo &status &page &limit
//   GET  /schedules/mine/:id
//   POST /schedules/mine/:id/start | /complete

import { apiRequest } from "../../services/api.js";

function query(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

const post = (path) => apiRequest(path, { method: "POST" });

export const manageApi = {
  list: (filters) => apiRequest(`/schedules${query(filters)}`),
  get: (id) => apiRequest(`/schedules/${id}`),
  start: (id) => post(`/schedules/${id}/start`),
  complete: (id) => post(`/schedules/${id}/complete`),
  cancel: (id) => post(`/schedules/${id}/cancel`),
};

export const ownApi = {
  list: (filters) => apiRequest(`/schedules/mine${query(filters)}`),
  get: (id) => apiRequest(`/schedules/mine/${id}`),
  start: (id) => post(`/schedules/mine/${id}/start`),
  complete: (id) => post(`/schedules/mine/${id}/complete`),
};

export const createSchedule = (input) =>
  apiRequest("/schedules", { method: "POST", body: input });

export const updateSchedule = (id, changes) =>
  apiRequest(`/schedules/${id}`, { method: "PUT", body: changes });

// Reads every page of a list endpoint (the backend caps a page at 100 rows).
export async function fetchAll(list, base = {}) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await list({ ...base, page: String(page), limit: "100" });
    items.push(...data.items);
    if (items.length >= data.total || data.items.length === 0) break;
  }
  return items;
}
