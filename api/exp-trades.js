import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// Closed-trade history for the XAU/USD pyramid Experimento — its own table
// (not `trades`), deliberately: this strategy's trades must never mix into
// the main bot's byPattern/byHour learning stats, see the EXP_* comment
// block in trading-bot-v3.jsx. DB-backed (not just localStorage) so the
// history is the same from any browser/device, not just the one that ran
// the engine.
export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });

  if (req.method === "GET") {
    const limit = Math.min(500, parseInt(req.query?.limit, 10) || 200);
    try {
      const r = await db.query(
        `SELECT symbol, type, entry_price, exit_price, pnl, reason, pattern, objetivo_pila, stop_pila, allocated_size, multiplier, opened_at, closed_at
         FROM exp_trades ORDER BY closed_at DESC LIMIT $1`,
        [limit]
      );
      const trades = r.rows.map(row => ({
        symbol: row.symbol, type: row.type,
        entry: parseFloat(row.entry_price), exit: parseFloat(row.exit_price),
        pnl: parseFloat(row.pnl), reason: row.reason, pattern: row.pattern,
        objetivoPila: row.objetivo_pila != null ? parseFloat(row.objetivo_pila) : undefined,
        stopPila: row.stop_pila != null ? parseFloat(row.stop_pila) : undefined,
        allocatedSize: row.allocated_size != null ? parseFloat(row.allocated_size) : undefined,
        multiplier: row.multiplier ?? undefined,
        time: row.closed_at ? new Date(row.closed_at).toLocaleTimeString("es") : "",
        tradeTime: row.closed_at ? Math.floor(new Date(row.closed_at).getTime() / 1000) : null,
        openTime: row.opened_at ? new Date(row.opened_at).getTime() : null,
        closeTime: row.closed_at ? new Date(row.closed_at).getTime() : null,
      }));
      return res.status(200).json({ trades });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { symbol, type, entryPrice, exitPrice, pnl, reason, pattern, objetivoPila, stopPila, allocatedSize, multiplier, openedAt, closedAt } = req.body || {};
    if (!type || entryPrice == null || exitPrice == null || pnl == null) {
      return res.status(400).json({ error: "type, entryPrice, exitPrice, pnl are required" });
    }
    try {
      await db.query(
        `INSERT INTO exp_trades (symbol, type, entry_price, exit_price, pnl, reason, pattern, objetivo_pila, stop_pila, allocated_size, multiplier, opened_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [symbol || "XAU/USD", type, entryPrice, exitPrice, pnl, reason || null, pattern || null,
         objetivoPila ?? null, stopPila ?? null,
         allocatedSize ?? null, multiplier ?? null,
         openedAt ? new Date(openedAt) : null, closedAt ? new Date(closedAt) : new Date()]
      );
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
