import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT || 5000);
const nodeEnv = process.env.NODE_ENV || "development";
// IANA zone that decides which calendar date "today" is (license expiry).
const businessTimezone = process.env.BUSINESS_TIMEZONE || "Asia/Karachi";
const databaseUrl = process.env.DATABASE_URL;
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL || null;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing from environment variables.");
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid port number.");
}

try {
  new Intl.DateTimeFormat("en-US", { timeZone: businessTimezone });
} catch {
  throw new Error("BUSINESS_TIMEZONE must be a valid IANA time zone name.");
}

export const env = {
  businessTimezone,
  port,
  nodeEnv,
  databaseUrl,
  migrationDatabaseUrl,
};
