import { addDays } from "../../utils/business-date.js";

// FR-LIC-02: "expiring soon" is today <= expiry <= today + 30 days.
export const EXPIRY_WARNING_DAYS = 30;

export function expiryWindowEnd(today) {
  return addDays(today, EXPIRY_WARNING_DAYS);
}

// The most specific classification of a license on `today`. "expiring_soon" is
// still a valid license; only "expired" (expiry < today) is not.
export function classifyLicense(expiryDate, today) {
  if (expiryDate < today) return "expired";
  return expiryDate <= expiryWindowEnd(today) ? "expiring_soon" : "valid";
}
