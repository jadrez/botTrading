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
let modeEnsured = false;
export default async function handler(req, res) {
  const db = getPool();
  if (!db) return res.status(500).json({ error: "DATABASE_URL not set" });
  if (!modeEnsured) {
    try { await db.query("ALTER TABLE exp_trades ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'SIM'"); modeEnsured = true; } catch {}
  }

  // ── RENDIMIENTO POR HORA — agregado en SQL sobre TODO el histórico, no
  // solo los últimos N que trae el GET normal. Reportado en vivo: "las
  // horas se están actualizando pero no me las está guardando... solo me
  // deja ver 2 horas" — no es que se perdieran datos, es que el GET normal
  // trae como máximo 500 filas (ORDER BY closed_at DESC), y con una
  // estrategia de piso tan chico generando decenas de trades por minuto,
  // esas 500 filas más recientes caben enteras dentro de 1-2 horas,
  // empujando fuera de esa ventana todo lo de "anoche". El gráfico de
  // RENDIMIENTO POR HORA necesita ver TODO el histórico agrupado, no una
  // ventana acotada de filas — por eso vive en una query aparte, con los
  // mismos filtros (fechas/símbolo/tipo/resultado) que ya usa el filtro
  // de arriba. tzOffsetMin es getTimezoneOffset() del navegador (positivo
  // si la hora local va detrás de UTC) — se resta de closed_at (UTC) para
  // agrupar por la hora LOCAL del usuario, no UTC del servidor.
  if (req.method === "GET" && req.query?.agg === "hourly") {
    const tzOffsetMin = parseInt(req.query?.tzOffsetMin, 10) || 0;
    const { symbol, from, to, type, result, mode } = req.query || {};
    const conditions = ["closed_at IS NOT NULL"];
    const params = [tzOffsetMin];
    let i = 2;
    if (symbol) { conditions.push(`symbol = $${i}`); params.push(symbol); i++; }
    if (from) { conditions.push(`closed_at >= $${i}`); params.push(new Date(`${from}T00:00:00`)); i++; }
    if (to) { conditions.push(`closed_at <= $${i}`); params.push(new Date(`${to}T23:59:59.999`)); i++; }
    if (type) { conditions.push(`type = $${i}`); params.push(type); i++; }
    if (result === "GANANCIA") conditions.push(`pnl >= 0`);
    if (result === "PERDIDA") conditions.push(`pnl < 0`);
    if (mode === "SIM" || mode === "DERIV") { conditions.push(`mode = $${i}`); params.push(mode); i++; }
    try {
      const r = await db.query(
        `SELECT EXTRACT(HOUR FROM (closed_at - make_interval(mins => $1)))::int AS hour,
                COUNT(*)::int AS trades, SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END)::int AS wins, SUM(pnl)::float AS pnl
         FROM exp_trades WHERE ${conditions.join(" AND ")} GROUP BY hour ORDER BY hour`,
        params
      );
      return res.status(200).json({ hours: r.rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    const limit = Math.min(500, parseInt(req.query?.limit, 10) || 200);
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    // Filtros opcionales (mismos que ?agg=hourly) — reportado en vivo:
    // "no sale paginación de nada y llevo más de 2 mil operaciones". La
    // tabla de HISTÓRICO filtraba/paginaba sobre expTrades del lado del
    // cliente, que: (a) solo trae 200 filas al montar, y (b) mientras esta
    // pestaña NO es dueña del motor, se refresca con apenas 50 — ninguna de
    // las dos ventanas alcanza para ver "ayer" entre miles de filas de hoy.
    // Con symbol/from/to/type/result + offset, la tabla puede pedirle al
    // SERVIDOR exactamente la página que necesita, filtrada en SQL sobre
    // TODO exp_trades, y total le dice cuántas páginas hay de verdad.
    const { symbol, from, to, type, result, mode } = req.query || {};
    const conditions = ["1=1"];
    const params = [];
    let i = 1;
    if (symbol) { conditions.push(`symbol = $${i}`); params.push(symbol); i++; }
    if (from) { conditions.push(`closed_at >= $${i}`); params.push(new Date(`${from}T00:00:00`)); i++; }
    if (to) { conditions.push(`closed_at <= $${i}`); params.push(new Date(`${to}T23:59:59.999`)); i++; }
    if (type) { conditions.push(`type = $${i}`); params.push(type); i++; }
    if (result === "GANANCIA") conditions.push(`pnl >= 0`);
    if (result === "PERDIDA") conditions.push(`pnl < 0`);
    if (mode === "SIM" || mode === "DERIV") { conditions.push(`mode = $${i}`); params.push(mode); i++; }
    const where = conditions.join(" AND ");
    try {
      const [r, countR] = await Promise.all([
        db.query(
          `SELECT symbol, type, entry_price, exit_price, pnl, reason, pattern, objetivo_pila, stop_pila, allocated_size, multiplier, opened_at, closed_at, mode
           FROM exp_trades WHERE ${where} ORDER BY closed_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...params, limit, offset]
        ),
        db.query(`SELECT COUNT(*)::int AS n FROM exp_trades WHERE ${where}`, params),
      ]);
      const trades = r.rows.map(row => ({
        symbol: row.symbol, type: row.type, mode: row.mode,
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
      return res.status(200).json({ trades, total: countR.rows[0].n });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { symbol, type, entryPrice, exitPrice, pnl, reason, pattern, objetivoPila, stopPila, allocatedSize, multiplier, openedAt, closedAt, mode } = req.body || {};
    if (!type || entryPrice == null || exitPrice == null || pnl == null) {
      return res.status(400).json({ error: "type, entryPrice, exitPrice, pnl are required" });
    }
    try {
      await db.query(
        `INSERT INTO exp_trades (symbol, type, entry_price, exit_price, pnl, reason, pattern, objetivo_pila, stop_pila, allocated_size, multiplier, opened_at, closed_at, mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [symbol || "XAU/USD", type, entryPrice, exitPrice, pnl, reason || null, pattern || null,
         objetivoPila ?? null, stopPila ?? null,
         allocatedSize ?? null, multiplier ?? null,
         openedAt ? new Date(openedAt) : null, closedAt ? new Date(closedAt) : new Date(), mode === "DERIV" ? "DERIV" : "SIM"]
      );
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
