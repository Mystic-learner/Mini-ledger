
import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { pool } from "./db";

async function start() {
  try {
    console.log("[MiniLedger] Starting backend...");
    console.log("[MiniLedger] Initializing database tables...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(16) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS loans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        friend_name VARCHAR(100) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
        due_date DATE NOT NULL,
        is_repaid BOOLEAN NOT NULL DEFAULT FALSE,
        repaid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("[MiniLedger] Database tables ready.");

    // Log incoming requests so we can verify which server handles them.
    app.use((req, _res, next) => {
      console.log(
        `[MiniLedger REQUEST] ${req.method} ${req.originalUrl}`
      );
      next();
    });

    const port = Number(process.env.PORT) || 5000;

    const server = app.listen(port, "0.0.0.0", () => {
      console.log(
        `[MiniLedger] API running at http://localhost:${port}`
      );
      console.log("[MiniLedger] Waiting for requests...");
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      console.error("[MiniLedger] HTTP server error:", error);

      if (error.code === "EADDRINUSE") {
        console.error(
          `[MiniLedger] Port ${port} is already in use. Stop the other server first.`
        );
      }

      process.exitCode = 1;
    });
  } catch (error) {
    console.error("[MiniLedger] Failed to start:", error);
    process.exitCode = 1;
  }
}

start();
