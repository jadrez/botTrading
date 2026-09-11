import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });

  if (req.method === "POST") {
    const {
      symbol, type, entryPrice, exitPrice, pnl, confidence = null,
      patterns = [], reasons = [], closeReason, openedAt, closedAt,
    } = req.body || {};
    if (!symbol || !type || entryPrice == null || exitPrice == null || pnl == null) {
      return res.status(400).json({ error: "symbol, type, entryPrice, exitPrice, pnl are required" });
    }
    try {
      const r = await db.query(
        `INSERT INTO trades (symbol, type, entry_price, exit_price, pnl, confidence, patterns, reasons, close_reason, opened_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [symbol, type, entryPrice, exitPrice, pnl, confidence,
         JSON.stringify(patterns), JSON.stringify(reasons), closeReason || null,
         openedAt ? new Date(openedAt) : new Date(), closedAt ? new Date(closedAt) : new Date()]
      );
      return res.status(200).json({ ok: true, id: r.rows[0].id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    const limit = Math.min(500, parseInt(req.query?.limit, 10) || 200);
    try {
      const r = await db.query(
        `SELECT symbol, type, entry_price, exit_price, pnl, confidence, patterns, reasons, close_reason, opened_at, closed_at
         FROM trades ORDER BY closed_at DESC NULLS LAST, opened_at DESC LIMIT $1`,
        [limit]
      );
      // Shape matches what calcLearningStats() in trading-bot-v3.jsx already expects
      // from the old localStorage trades array — see LS_TRADES.
      const trades = r.rows.map(row => ({
        symbol: row.symbol,
        type: row.type,
        entry: parseFloat(row.entry_price),
        exit: parseFloat(row.exit_price),
        pnl: parseFloat(row.pnl),
        confidence: row.confidence,
        activePatterns: row.patterns || [],
        reason: row.close_reason,
        time: row.closed_at ? new Date(row.closed_at).toLocaleTimeString("es") : "",
        tradeTime: row.closed_at ? Math.floor(new Date(row.closed_at).getTime() / 1000) : null,
      }));
      return res.status(200).json({ trades });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
