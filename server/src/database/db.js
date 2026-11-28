import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

// Log unexpected connection errors
pool.on("error", (err) => {
  console.error("Unexpected database error:", err.message);
});

// Test database connection
export async function testDatabaseConnection() {
 const result = await pool.query(
  "SELECT NOW(), current_user, current_database()"
);

console.log("Database user:", result.rows[0].current_user);
console.log("Database name:", result.rows[0].current_database);

  console.log("Database connected successfully.");
  return result.rows[0];
}
