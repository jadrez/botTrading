import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// Velas de 1 minuto grabadas por el motor del servidor con el precio REAL de Deriv (tabla price_candles).
// GET /api/price-candles?symbol=XAU/USD&days=30  → [{time, o, h, l, c, n}] en orden cronológico.
// Sirve para repetir los backtests (backtest/exp-*.mjs) con datos propios de Deriv en vez de PAXG.
export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const symbol = String(req.query.symbol || "XAU/USD");
  const days = Math.min(365, Math.max(0.01, parseFloat(req.query.days) || 30));
  try {
    const r = await db.query(
      `SELECT t, o, h, l, c, n FROM price_candles WHERE symbol = $1 AND t >= $2 ORDER BY t ASC LIMIT 200000`,
      [symbol, Math.floor(Date.now() / 1000 - days * 86400)]
    );
    return res.status(200).json(r.rows.map(x => ({ time: Number(x.t), o: x.o, h: x.h, l: x.l, c: x.c, n: x.n })));
  } catch (e) {
    if (/price_candles/.test(e.message)) return res.status(200).json([]); // aún no existe: nadie ha grabado
    return res.status(500).json({ error: e.message });
  }
}
