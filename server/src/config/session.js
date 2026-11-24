import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../database/db.js";

const PgSessionStore = connectPgSimple(session);

const sessionStore = new PgSessionStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true,
});

export const sessionMiddleware = session({
  store: sessionStore,
  name: "bus_management.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 30, // 30 minutes
  },
});
