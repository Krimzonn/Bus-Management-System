import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT || 5000);
const nodeEnv = process.env.NODE_ENV || "development";
const databaseUrl = process.env.DATABASE_URL;
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL || null;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing from environment variables.");
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid port number.");
}

export const env = {
  port,
  nodeEnv,
  databaseUrl,
  migrationDatabaseUrl,
};
