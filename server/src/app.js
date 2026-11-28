import express from "express";
import { pool } from "./database/db.js";
import { sessionMiddleware } from "./config/session.js";
import authRoutes from "./modules/auth/routes.js";
import accountRoutes from "./modules/auth/account-routes.js";
import auditRoutes from "./modules/audit/routes.js";
import busRoutes from "./modules/fleet/routes.js";
import routeRoutes from "./modules/routes/routes.js";
import driverRoutes from "./modules/drivers/routes.js";
import scheduleRoutes from "./modules/scheduling/routes.js";
import recruitmentRoutes from "./modules/recruitment/routes.js";

const app = express();
app.use(express.json());
app.use(sessionMiddleware);

app.get("/", (_req, res) =>
  res.status(200).json({
    success: true,
    message: "Bus Management System API is running.",
    data: null,
  }),
);

app.get("/api/v1/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({
      success: true,
      message: "API and database are healthy.",
      data: { status: "healthy", database: "connected" },
    });
  } catch {
    return res
      .status(503)
      .json({
        success: false,
        message: "Database connection unavailable.",
        data: null,
      });
  }
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/accounts", accountRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/buses", busRoutes);
app.use("/api/v1/routes", routeRoutes);
app.use("/api/v1/drivers", driverRoutes);
app.use("/api/v1/schedules", scheduleRoutes);
app.use("/api/v1/recruitment", recruitmentRoutes);

app.use((req, res) =>
  res.status(404).json({
    success: false,
    message: "Route not found.",
    data: null,
  }),
);

app.use((err, _req, res, _next) => {
  if (Number.isInteger(err.status) && typeof err.code === "string") {
    return res
      .status(err.status)
      .json({ success: false, code: err.code, data: null });
  }
  console.error("BUS MANAGEMENT API ERROR:");
  console.error("Message:", err.message);
  console.error("Code:", err.code);
  console.error("Detail:", err.detail);
  console.error("Constraint:", err.constraint);
  console.error("Stack:", err.stack);
  return res
    .status(500)
    .json({ success: false, message: "Internal server error.", data: null });
});

export default app;
