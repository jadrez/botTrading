import pg from "pg";

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// Config + live engine state for the XAU/USD pyramid Experimento — reuses
// bot_config (key/value, already exists for the main bot's TP/SL/stake)
// instead of a bespoke table, since this is the exact same shape: a handful
// of scalars (enabled, stake, addStep, floorStart) plus one JSON blob
// (live positions/direction/floor/addLevel/peak) and an engine-ownership
// heartbeat (which tab is actively driving decisions, so two open tabs/
// devices can't both pyramid the same price crossing). All exp_ keys live
// under this one table, never touching bot_config's own non-exp_ keys.
export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });

  if (req.method === "GET") {
    try {
      const r = await db.query(`SELECT key, value FROM bot_config WHERE key LIKE 'exp\\_%' ESCAPE '\\'`);
      const out = {};
      r.rows.forEach(row => { out[row.key] = row.value; });
      return res.status(200).json(out);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { key, value } = req.body || {};
    if (!key || typeof key !== "string" || !key.startsWith("exp_")) {
      return res.status(400).json({ error: "key must start with exp_" });
    }
    try {
      // Con Deriv (real) activo, SOLO el motor del servidor (que escribe directo a la DB)
      // puede fijar el dueño y el estado vivo de la pila; un navegador (pestaña vieja,
      // otro dispositivo) los pisaba y dejaba contratos reales huérfanos en Deriv.
      if (key === "exp_live_state" || key === "exp_engine_owner") {
        const lv = await db.query(`SELECT value FROM bot_config WHERE key = 'exp_deriv_live'`);
        if (lv.rows[0]?.value === "1") return res.status(200).json({ ok: true, ignored: "deriv-live" });
      }
      await db.query(
        `INSERT INTO bot_config (key, value, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, String(value)]
      );
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
