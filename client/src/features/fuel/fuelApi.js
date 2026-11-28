// Fuel API calls (Slice 11). Every request goes through the shared apiRequest,
// so session, CSRF and 401 handling are unchanged.
//
//   GET  /fuel               ?archived &busId &purchaseFrom &purchaseTo &page &limit
//                            -> { items, page, limit, total }
//   GET  /fuel/summary       ?startDate &endDate (required, inclusive) &busId &archived (false|all)
//                            -> { startDate, endDate, busId, archived, recordCount, totalLiters,
//                                 totalCost, efficiency, buses }
//   GET  /fuel/bus/:busId    ?archived &purchaseFrom &purchaseTo &page &limit
//                            -> { bus, items, page, limit, total }   (oldest first)
//   GET  /fuel/:id
//   POST /fuel               { busId, purchaseDate, liters, totalCost, odometer }
//   PUT  /fuel/:id           any of purchaseDate, liters, totalCost, odometer
//   POST /fuel/:id/archive   (Admin only)

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

export const listFuel = (filters) => apiRequest(`/fuel${query(filters)}`);

export const getFuelSummary = (filters) => apiRequest(`/fuel/summary${query(filters)}`);

export const getBusFuelHistory = (busId, filters) =>
  apiRequest(`/fuel/bus/${id(busId)}${query(filters)}`);

export const getFuelRecord = (recordId) => apiRequest(`/fuel/${id(recordId)}`);

export const createFuel = (input) => apiRequest("/fuel", { method: "POST", body: input });

export const updateFuel = (recordId, changes) =>
  apiRequest(`/fuel/${id(recordId)}`, { method: "PUT", body: changes });

export const archiveFuel = (recordId) =>
  apiRequest(`/fuel/${id(recordId)}/archive`, { method: "POST" });

// Reads every page of the bus list (the backend caps a page at 100 rows).
export async function fetchAllBuses(archived = "all") {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await listBuses({ archived, page: String(page), limit: "100" });
    items.push(...data.items);
    if (items.length >= data.total || data.items.length === 0) break;
  }
  return items;
}