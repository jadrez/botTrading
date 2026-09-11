import "dotenv/config";
import pg from "pg";

let pool = null;

export function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}
