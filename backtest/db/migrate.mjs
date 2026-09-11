import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPool } from "../lib/db.mjs";

const pool = getPool();
if (!pool) {
  console.error("DATABASE_URL no está configurada (revisa .env).");
  process.exit(1);
}

const sql = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");

try {
  await pool.query(sql);
  console.log("Esquema aplicado: sweep_results, trades, open_positions, walkforward_folds, bot_config.");
} catch (err) {
  console.error("Error aplicando el esquema:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
