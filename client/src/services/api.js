// The only place in the client that calls fetch (API client boundary).
//
// Backend contract (Slice 2):
//   success: { success: true,  data }
//   failure: { success: false, code, data: null }   <- stable error code, no text
//
// Authentication uses the server-managed session cookie (httpOnly), so the
// browser sends it automatically. The CSRF token is NOT a secret credential,
// but we still keep it in memory only (never in localStorage).

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

// Error codes are translated to readable English here. All UI text for errors
// lives in this one map, so it is easy to translate later.
const ERROR_MESSAGES = {
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
  NETWORK_ERROR: "Cannot reach the server. Check your connection and try again.",
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
  return ROLES.find((role) => role.key === roleKey)?.label || "No role assigned";
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
