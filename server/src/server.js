import app from "./app.js";
import { env } from "./config/env.js";
import { startNotificationJobs } from "./config/notifications.js";
import { testDatabaseConnection } from "./database/db.js";

async function startServer() {
  try {
    await testDatabaseConnection();

    app.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
      console.log(`Environment: ${env.nodeEnv}`);
    });

    // Periodic license/maintenance alert check (repeat-safe; see ADR-009).
    startNotificationJobs();
  } catch (error) {
    console.error("Failed to start server:", error);
    console.error("Error stack:", error?.stack);
    process.exit(1);
  }
}

startServer();
