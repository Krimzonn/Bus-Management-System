import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;
const migrationPool = new Pool({
  connectionString: env.migrationDatabaseUrl || env.databaseUrl,
});

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

async function runMigrations() {
  const client = await migrationPool.connect();

  try {
    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationDirectory = path.join(currentDirectory, "migrations");

    const files = (await fs.readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const result = await client.query(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [file],
      );

      if (result.rows.length > 0) {
        console.log(`Already applied: ${file}`);
        continue;
      }

      const sql = await fs.readFile(
        path.join(migrationDirectory, file),
        "utf8",
      );

      await client.query("BEGIN");

      try {
        await client.query(sql);

        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );

        await client.query("COMMIT");

        console.log(`Applied: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Migration process completed.");
  } finally {
    client.release();
    await migrationPool.end();
  }
}

runMigrations().catch(async (error) => {
  console.error("Migration failed:", error.message);
  await migrationPool.end();
  process.exitCode = 1;
});
