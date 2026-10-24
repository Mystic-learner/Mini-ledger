
import dotenv from "dotenv";
import { Pool, types } from "pg";

dotenv.config();

// Keep PostgreSQL DATE values as YYYY-MM-DD strings.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});
