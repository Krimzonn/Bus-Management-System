import { pool } from "./db.js";

async function seedDatabase() {
  try {
    await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ('application_name', 'Bus Management System')
            ON CONFLICT (setting_key) DO NOTHING;
        `);

    console.log("Database seeding completed.");
  } catch (error) {
    console.error("Database seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedDatabase();
