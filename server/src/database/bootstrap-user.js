import { pool } from "./db.js";
import { hashPassword } from "../modules/auth/passwords.js";

async function bootstrapUser() {
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD;

  if (!email || !password || password.length < 12) {
    throw new Error(
      "Provide BOOTSTRAP_EMAIL and a BOOTSTRAP_PASSWORD of at least 12 characters.",
    );
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Prevent two bootstrap processes from creating accounts simultaneously.
    await client.query("LOCK TABLE iam_users IN EXCLUSIVE MODE");

    const existing = await client.query("SELECT COUNT(*) FROM iam_users");

    if (Number(existing.rows[0].count) > 0) {
      throw new Error("Bootstrap refused: an account already exists.");
    }

    const result = await client.query(
      `INSERT INTO iam_users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, is_active`,
      [email, passwordHash],
    );

    await client.query("COMMIT");

    console.log("Initial account created successfully.");
    console.log(`Account ID: ${result.rows[0].id}`);
    console.log(`Email: ${result.rows[0].email}`);
    console.log("Role: unassigned");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

bootstrapUser()
  .catch((error) => {
    console.error("Bootstrap failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
