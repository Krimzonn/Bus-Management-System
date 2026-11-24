import express from "express";
import { pool } from "./database/db.js";
import { sessionMiddleware } from "./config/session.js";
import authRoutes from "./modules/auth/routes.js";
import accountRoutes from "./modules/auth/account-routes.js";

const app = express();

app.use(express.json());
app.use(sessionMiddleware);

// Basic API route
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Bus Management System API is running.",
    data: null,
  });
});

// Health check
app.get("/api/v1/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      message: "API and database are healthy.",
      data: {
        status: "healthy",
        database: "connected",
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      message: "Database connection unavailable.",
      data: null,
    });
  }
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/accounts", accountRoutes);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
    data: null,
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  // Handle known authorization errors using stable error codes.
  if (Number.isInteger(err.status) && typeof err.code === "string") {
    return res.status(err.status).json({
      success: false,
      code: err.code,
      data: null,
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
    data: null,
  });
});

export default app;
