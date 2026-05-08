const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const pino = require("pino");
const pinoHttp = require("pino-http");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: ["req.headers.authorization"],
});

const port = Number(process.env.PORT || 8080);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(pinoHttp({ logger }));

// Optional API rewrite
app.use((req, _res, next) => {
  if (req.url === "/api") req.url = "/";
  else if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  next();
});

/* =========================
   HEALTH (NO DB)
========================= */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "ledgerly-api",
    time: new Date().toISOString(),
  });
});

/* =========================
   READY CHECK
========================= */
app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).send("ready");
  } catch (err) {
    res.status(503).send("not ready");
  }
});

/* =========================
   DB MIGRATION (NO EXTENSIONS)
========================= */
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      monthly_budget NUMERIC(12, 2) NOT NULL DEFAULT 2500,
      currency TEXT NOT NULL DEFAULT 'USD',
      savings_goal NUMERIC(12, 2) NOT NULL DEFAULT 10000,
      preferred_category TEXT NOT NULL DEFAULT 'Food',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      weekly_digest BOOLEAN NOT NULL DEFAULT TRUE,
      spend_alerts BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/* =========================
   START SERVER (STABLE)
========================= */
async function startServer() {
  try {
    await migrate();
    logger.info("Database migration completed");

    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "ledgerly-api started");
    });
  } catch (error) {
    logger.error(error, "startup failed - retrying in 10s");
    setTimeout(startServer, 10000);
  }
}

startServer();