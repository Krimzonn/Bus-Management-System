// The only place in the client that calls fetch (API client boundary).
//
// Backend contract (Slice 2):
//   success: { success: true,  data }
//   failure: { success: false, code, data: null }   <- stable error code, no text
//
// Authentication uses the server-managed session cookie (httpOnly), so the
// browser sends it automatically. The CSRF token is NOT a secret credential,
// but we still keep it in memory only (never in localStorage).

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "/api/v1";

// Error codes are translated to readable English here. All UI text for errors
// lives in this one map, so it is easy to translate later.
const ERROR_MESSAGES = {
  INVALID_RECRUITMENT_INPUT:
    "Check the required application or interview fields.",
  INVALID_APPLICATION_ID: "Invalid application identifier.",
  APPLICATION_NOT_FOUND: "Application not found.",
  DUPLICATE_APPLICATION: "You already submitted an application.",
  INVALID_APPLICATION_TRANSITION:
    "This workflow action is not allowed at the current stage.",
  DRIVER_REGISTRATION_NOT_ELIGIBLE:
    "Only selected applicants may register as drivers.",
  DRIVER_ALREADY_REGISTERED: "You have already registered as a driver.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  INVALID_INPUT: "Please enter both email and password.",
  AUTHENTICATION_REQUIRED: "Your session has expired. Please sign in again.",
  ACCOUNT_INACTIVE: "This account has been deactivated.",
  INSUFFICIENT_PERMISSION: "You do not have permission to do that.",
  CSRF_VALIDATION_FAILED: "Security check failed. Please try again.",
  INVALID_EMAIL: "Please enter a valid email address.",
  INVALID_PASSWORD: "Password must be at least 12 characters.",
  INVALID_ROLE: "Please choose a role.",
  ROLE_NOT_FOUND: "That role does not exist.",
  INVALID_ACCOUNT_STATUS: "Invalid account status.",
  INVALID_ACCOUNT_ID: "Invalid account.",
  ACCOUNT_NOT_FOUND: "Account not found.",
  ACCOUNT_ALREADY_EXISTS: "An account with this email already exists.",
  SELF_ROLE_CHANGE_FORBIDDEN: "You cannot change your own role.",
  SELF_DEACTIVATION_FORBIDDEN: "You cannot deactivate your own account.",
  // Fleet (buses)
  INVALID_BUS_NUMBER:
    "Enter a valid bus number: up to 30 letters, digits, spaces, “/” or “-”.",
  INVALID_SEATING_CAPACITY:
    "Seating capacity must be a whole number from 1 to 100.",
  INVALID_LICENSE_CATEGORY:
    "Enter a valid license category: up to 20 letters, digits, spaces or “-”.",
  INVALID_BUS_STATUS: "Choose a valid bus status.",
  INVALID_BUS_ID: "This bus identifier is not valid.",
  INVALID_BUS_FILTER:
    "One of the filters is not valid. Check the values and try again.",
  INVALID_PAGINATION:
    "That page is not available. Go back to the first page and try again.",
  BUS_NOT_FOUND: "This bus no longer exists. Refresh the list.",
  BUS_ALREADY_EXISTS:
    "A bus with this number already exists. Bus numbers are unique and are never reused, even after archiving.",
  BUS_ARCHIVED: "This bus is archived and can no longer be changed.",
  BUS_ALREADY_ARCHIVED: "This bus is already archived.",
  BUS_NUMBER_IMMUTABLE:
    "A bus number cannot be changed after the bus is created.",
  // Routes
  INVALID_ROUTE_CODE:
    "Enter a valid route code: up to 30 letters, digits, spaces, “/” or “-”.",
  INVALID_ROUTE_NAME: "Enter a route name of up to 100 characters.",
  INVALID_ROUTE_ORIGIN: "Enter an origin of up to 100 characters.",
  INVALID_ROUTE_DESTINATION: "Enter a destination of up to 100 characters.",
  INVALID_ROUTE_STATUS: "Choose a valid route status.",
  INVALID_ROUTE_ID: "This route identifier is not valid.",
  INVALID_ROUTE_FILTER:
    "One of the filters is not valid. Check the values and try again.",
  ROUTE_NOT_FOUND: "This route no longer exists. Refresh the list.",
  ROUTE_ALREADY_EXISTS:
    "A route with this code already exists. Route codes are unique and are never reused, even after archiving.",
  ROUTE_ARCHIVED: "This route is archived and can no longer be changed.",
  ROUTE_ALREADY_ARCHIVED: "This route is already archived.",
  ROUTE_CODE_IMMUTABLE:
    "A route code cannot be changed after the route is created.", // Drivers
  INVALID_DRIVER_NAME: "Enter a driver name of up to 100 characters.",
  INVALID_LICENSE_NUMBER:
    "Enter a valid license number: up to 30 letters, digits, spaces, “/” or “-”.",
  INVALID_LICENSE_EXPIRY_DATE: "Enter a valid license expiry date.",
  INVALID_DRIVER_STATUS: "Choose a valid driver status.",
  INVALID_DRIVER_ID: "This driver identifier is not valid.",
  INVALID_DRIVER_FILTER:
    "One of the filters is not valid. Check the values and try again.",
  DRIVER_NOT_FOUND: "This driver no longer exists. Refresh the list.",
  DRIVER_LICENSE_ALREADY_EXISTS:
    "A driver with this license number already exists. License numbers are unique, even for archived drivers.",
  DRIVER_ARCHIVED: "This driver is archived and can no longer be changed.",
  DRIVER_ALREADY_ARCHIVED: "This driver is already archived.",
  NETWORK_ERROR:
    "Cannot reach the server. Check your connection and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

// Roles that exist in the backend. Labels are display text only; the backend
// decides what each role may do (only admin can manage accounts for now).
export const ROLES = [
  { key: "admin", label: "Admin" },
  { key: "administrative_staff", label: "Administrative Staff" },
  { key: "transportation_manager", label: "Transportation Manager" },
  { key: "driver", label: "Driver" },
  { key: "applicant", label: "Applicant" },
  { key: "passenger", label: "Passenger" },
];

export function roleLabel(roleKey) {
  return (
    ROLES.find((role) => role.key === roleKey)?.label || "No role assigned"
  );
}

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }

  get userMessage() {
    return ERROR_MESSAGES[this.code] || ERROR_MESSAGES.UNKNOWN;
  }
}

// Turn any thrown value into text that is safe to show the user.
export function errorMessage(error) {
  return error instanceof ApiError ? error.userMessage : ERROR_MESSAGES.UNKNOWN;
}

let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

// Called when the server says the session is gone (401). App.jsx sets this so
// the UI can return to the login screen from anywhere.
let onSessionExpired = () => {};

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

async function fetchCsrfToken() {
  const response = await rawRequest("/auth/csrf");
  csrfToken = response.data.csrfToken;
  return csrfToken;
}

async function rawRequest(endpoint, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-CSRF-Token"] = token;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response (e.g. proxy error page). Handled below.
  }

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiError(payload?.code || "UNKNOWN", response.status);
  }

  return payload;
}

// Main request function used by all API calls.
// Every request sends the CSRF token: the backend requires it on state-changing
// requests and on the /accounts GET routes too.
export async function apiRequest(endpoint, options = {}) {
  const needsToken = endpoint !== "/health" && endpoint !== "/auth/csrf";
  if (needsToken && !csrfToken) await fetchCsrfToken();

  try {
    const payload = await rawRequest(endpoint, {
      ...options,
      token: needsToken ? csrfToken : undefined,
    });
    return payload.data;
  } catch (error) {
    // 401 on a protected call means the session ended. Not for login itself,
    // where 401 simply means wrong credentials.
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      endpoint !== "/auth/login"
    ) {
      clearCsrfToken();
      onSessionExpired();
    }
    // A stale token is replaced automatically on the next request.
    if (error instanceof ApiError && error.code === "CSRF_VALIDATION_FAILED") {
      clearCsrfToken();
    }
    throw error;
  }
}

// ---- Health ----------------------------------------------------------------

export function getHealth() {
  return apiRequest("/health");
}

// ---- Authentication --------------------------------------------------------

// Returns the signed-in user, or null when there is no valid session.
export async function getCurrentUser() {
  try {
    const data = await rawRequest("/auth/me");
    return data.data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function login(email, password) {
  // The login request needs a CSRF token from before login.
  const token = await fetchCsrfToken();
  const data = await rawRequest("/auth/login", {
    method: "POST",
    body: { email, password },
    token,
  });
  // The session is regenerated on login, so use the refreshed token.
  setCsrfToken(data.data.csrfToken);
  return data.data.user;
}

export async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    clearCsrfToken();
  }
}

// ---- Internal accounts (Admin) ----------------------------------------------

export const listAccounts = () => apiRequest("/accounts");

export const getAccount = (id) => apiRequest(`/accounts/${id}`);

export const createAccount = (email, password) =>
  apiRequest("/accounts", { method: "POST", body: { email, password } });

export const updateAccountEmail = (id, email) =>
  apiRequest(`/accounts/${id}`, { method: "PUT", body: { email } });

export const assignAccountRole = (id, role) =>
  apiRequest(`/accounts/${id}/role`, { method: "PUT", body: { role } });

export const setAccountActive = (id, isActive) =>
  apiRequest(`/accounts/${id}/status`, { method: "PATCH", body: { isActive } });

// Admin audit log
export const listAudit = (filters = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, value);
  }
  const query = params.toString();
  return apiRequest("/audit" + (query ? "?" + query : ""));
};

// ---- Buses (Fleet) -----------------------------------------------------------
//
// GET    /buses            ?q &status &requiredLicenseCategory &archived &page &limit
//                          -> { items, page, limit, total }
// GET    /buses/:id        -> bus
// POST   /buses            { busNumber, seatingCapacity, requiredLicenseCategory, status? }
// PUT    /buses/:id        { seatingCapacity?, requiredLicenseCategory? }
// PATCH  /buses/:id/status { status }
// POST   /buses/:id/archive

export const listBuses = (filters = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, value);
  }
  const query = params.toString();
  return apiRequest("/buses" + (query ? "?" + query : ""));
};

export const getBus = (id) => apiRequest(`/buses/${id}`);

export const createBus = (input) =>
  apiRequest("/buses", { method: "POST", body: input });

export const updateBus = (id, changes) =>
  apiRequest(`/buses/${id}`, { method: "PUT", body: changes });

export const setBusStatus = (id, status) =>
  apiRequest(`/buses/${id}/status`, { method: "PATCH", body: { status } });

export const archiveBus = (id) =>
  apiRequest(`/buses/${id}/archive`, { method: "POST" });

// ---- Routes ------------------------------------------------------------------
//
// GET    /routes             ?q &status &archived &page &limit
//                            -> { items, page, limit, total }
// GET    /routes/selectable  ?q &page &limit  (unblocked, non-archived only)
// GET    /routes/:id         -> route
// POST   /routes             { routeCode, name, origin, destination, status? }
// PUT    /routes/:id         { name?, origin?, destination? }  (routeCode is immutable)
// PATCH  /routes/:id/status  { status: "unblocked" | "blocked" }
// POST   /routes/:id/archive

function buildQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, value);
  }
  const query = params.toString();
  return query ? "?" + query : "";
}

export const listRoutes = (filters = {}) =>
  apiRequest("/routes" + buildQuery(filters));

// For the future Scheduling screens: only routes a new assignment may use.
export const listSelectableRoutes = (filters = {}) =>
  apiRequest("/routes/selectable" + buildQuery(filters));

export const getRoute = (id) => apiRequest(`/routes/${id}`);

export const createRoute = (input) =>
  apiRequest("/routes", { method: "POST", body: input });

export const updateRoute = (id, changes) =>
  apiRequest(`/routes/${id}`, { method: "PUT", body: changes });

export const setRouteStatus = (id, status) =>
  apiRequest(`/routes/${id}/status`, { method: "PATCH", body: { status } });

export const archiveRoute = (id) =>
  apiRequest(`/routes/${id}/archive`, { method: "POST" });
// ---- Drivers ----------------------------------------------------------------
//
// GET    /drivers                 ?q &status &licenseStatus &licenseCategory &archived &page &limit
//                                 -> { items, page, limit, total }
// GET    /drivers/license-expiry  ?state (valid|expiring_soon|expired) &page &limit
//                                 -> { state, asOf, expiringSoonThrough, items, page, limit, total }
// GET    /drivers/:id             -> driver
// POST   /drivers                 { fullName, licenseNumber, licenseCategory, licenseExpiryDate, status? }
// PUT    /drivers/:id             any of fullName, licenseNumber, licenseCategory, licenseExpiryDate
// PATCH  /drivers/:id/status      { status: "available" | "on_leave" | "absent" }
// POST   /drivers/:id/archive

export const listDrivers = (filters = {}) =>
  apiRequest("/drivers" + buildQuery(filters));

export const listLicenseExpiry = (filters = {}) =>
  apiRequest("/drivers/license-expiry" + buildQuery(filters));

export const getDriver = (id) => apiRequest(`/drivers/${id}`);

export const createDriver = (input) =>
  apiRequest("/drivers", { method: "POST", body: input });

export const updateDriver = (id, changes) =>
  apiRequest(`/drivers/${id}`, { method: "PUT", body: changes });

export const setDriverStatus = (id, status) =>
  apiRequest(`/drivers/${id}/status`, { method: "PATCH", body: { status } });

export const archiveDriver = (id) =>
  apiRequest(`/drivers/${id}/archive`, { method: "POST" });
// Slice 9 — Recruitment. All paths use the existing session/CSRF boundary.
export const registerApplicant = (input) =>
  apiRequest("/auth/register-applicant", { method: "POST", body: input });
export const listRecruitment = (own, filters = {}) =>
  apiRequest("/recruitment" + (own ? "/own" : buildQuery(filters)));
export const getRecruitment = (own, id) =>
  apiRequest(`/recruitment${own ? "/own" : ""}/${encodeURIComponent(id)}`);
export const submitRecruitment = (input) =>
  apiRequest("/recruitment/own", { method: "POST", body: input });
export const changeRecruitmentStatus = (id, input) =>
  apiRequest(`/recruitment/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: input,
  });
export const saveRecruitmentInterview = (id, input) =>
  apiRequest(`/recruitment/${encodeURIComponent(id)}/interview`, {
    method: "PUT",
    body: input,
  });
export const registerRecruitmentDriver = (id, input) =>
  apiRequest(`/recruitment/own/${encodeURIComponent(id)}/driver`, {
    method: "POST",
    body: input,
  });
