import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// Live mirror of currently-open positions — see backtest/db/schema.sql for
// why this is a separate table from `trades` (history vs current state).
export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });

  if (req.method === "GET") {
    try {
      const r = await db.query(`SELECT * FROM open_positions ORDER BY opened_at ASC`);
      const positions = r.rows.map(row => ({
        id: row.client_id, symbol: row.symbol, type: row.type,
        entry: parseFloat(row.entry_price),
        allocatedSize: row.allocated_size != null ? parseFloat(row.allocated_size) : undefined,
        multiplier: row.multiplier ?? undefined,
        tp: row.tp != null ? parseFloat(row.tp) : undefined,
        sl: row.sl != null ? parseFloat(row.sl) : undefined,
        derivContractId: row.deriv_contract_id ?? undefined,
        commission: row.commission != null ? parseFloat(row.commission) : undefined,
        openedBy: row.opened_by ?? "BOT",
        openTime: new Date(row.opened_at).getTime(),
      }));
      return res.status(200).json({ positions });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { clientId, symbol, type, entryPrice, allocatedSize, multiplier, confidence, tp, sl, derivContractId, commission, openedBy } = req.body || {};
    if (!clientId || !symbol || !type || entryPrice == null) {
      return res.status(400).json({ error: "clientId, symbol, type, entryPrice are required" });
    }
    try {
      const params = [String(clientId), symbol, type, entryPrice, allocatedSize ?? null, multiplier ?? null, confidence ?? null, tp ?? null, sl ?? null, derivContractId ? String(derivContractId) : null, commission ?? null, openedBy === "MANUAL" ? "MANUAL" : "BOT"];
      // A real position conflicts on deriv_contract_id (the partial unique
      // index in schema.sql) — the client-side "is this contract already
      // tracked?" check can race (e.g. right after a reload, before the
      // DB-restore fetch finishes) and insert the same real contract twice
      // under two different client_ids. A simulated position has no
      // contract id to collide on, so it only needs the client_id guard
      // (idempotent retries of the same insert).
      const conflictClause = derivContractId
        ? `ON CONFLICT (deriv_contract_id) WHERE deriv_contract_id IS NOT NULL DO NOTHING`
        : `ON CONFLICT (client_id) DO NOTHING`;
      await db.query(
        `INSERT INTO open_positions (client_id, symbol, type, entry_price, allocated_size, multiplier, confidence, tp, sl, deriv_contract_id, commission, opened_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ${conflictClause}`,
        params
      );
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    const clientId = req.query?.clientId;
    if (!clientId) return res.status(400).json({ error: "clientId query param is required" });
    try {
      await db.query(`DELETE FROM open_positions WHERE client_id = $1`, [String(clientId)]);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
