import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// Live copy of SYMBOL_STRATEGY, refreshed by backtest/update-strategy.mjs
// (see .github/workflows) — lets tiers/TP/SL drift without a redeploy.
// The frontend keeps its hardcoded SYMBOL_STRATEGY as the fallback when this
// table is empty or unreachable.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const db = getPool();
  if (!db) return res.status(200).json({ strategies: [] });

  try {
    const r = await db.query(`SELECT symbol, tier, tp, sl, min_conf, updated_at FROM symbol_strategy`);
    const strategies = r.rows.map(row => ({
      symbol: row.symbol,
      tier: row.tier,
      tp: row.tp != null ? parseFloat(row.tp) : undefined,
      sl: row.sl != null ? parseFloat(row.sl) : undefined,
      minConf: row.min_conf ?? undefined,
      updatedAt: row.updated_at,
    }));
    return res.status(200).json({ strategies });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
