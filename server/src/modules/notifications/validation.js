const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;

export function notificationError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

export function parseNotificationId(value) {
  if (
    typeof value !== "string" ||
    !/^\d{1,18}$/.test(value) ||
    Number(value) < 1
  ) {
    throw notificationError("INVALID_NOTIFICATION_ID", 400);
  }
  return value;
}

// The recipient always comes from the authenticated session, never from the client.
// A malformed value here is a server bug, not a client error.
export function parseRecipientId(value) {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (
    typeof text !== "string" ||
    !/^\d{1,18}$/.test(text) ||
    BigInt(text) < 1n
  ) {
    throw notificationError("INVALID_RECIPIENT", 500);
  }
  return String(BigInt(text));
}

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw notificationError("INVALID_PAGINATION", 400);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw notificationError("INVALID_PAGINATION", 400);
  return n;
}

// Only unread, page and limit are accepted. Any other key (for example a
// recipientId) is rejected rather than ignored.
export function parseListFilters(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw notificationError("INVALID_NOTIFICATION_FILTER", 400);
  }
  for (const key of Object.keys(query)) {
    if (!["unread", "page", "limit"].includes(key)) {
      throw notificationError("INVALID_NOTIFICATION_FILTER", 400);
    }
  }
  let unread = false;
  if (query.unread !== undefined) {
    if (query.unread !== "true" && query.unread !== "false") {
      throw notificationError("INVALID_NOTIFICATION_FILTER", 400);
    }
    unread = query.unread === "true";
  }
  return {
    unread,
    page: parsePositiveInteger(query.page, 1, MAX_PAGE),
    limit: parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  };
}
