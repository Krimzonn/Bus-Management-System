import express from "express";
import { pool } from "./database/db.js";

const app = express();

app.use(express.json());

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
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error.",
    data: null,
  });
});

export default app;
