// Server-side engine for the "Experimento XAU/USD" pyramid strategy — the
// exact same algorithm already implemented client-side in
// trading-bot-v3.jsx (see the EXP_* comment block there for the full
// design rationale), ported to plain Node so it keeps running 24/7 on
// Fly.io instead of depending on a browser tab staying open. Requested
// explicitly after the user pointed out Fly.io already runs a persistent
// server with a domain — there was no technical reason this needed a
// browser at all, that was just how it was first built.
//
// Ownership: Fly can run more than one machine for this app, and a
// browser tab may still have the page open too — all of them run this
// SAME claim/heartbeat protocol via bot_config (exp_engine_owner), so only
// one of them ever actually calls addExpPos/flip at a time. A server
// instance's heartbeat renews every ~5s nonstop, so once it's running it
// will almost always hold ownership over any browser tab that opens later
// (a tab's own heartbeat check correctly defers to it) — no client code
// changes were needed for this, the protocol is identity-agnostic by design.
import pg from "pg";

const EXP_SYMBOL = "XAU/USD";
const EXP_BINANCE = "PAXGUSDT";
const DEFAULT_MULTIPLIER = 100;
const EXP_RETAIN_PCT = 0.8;
const EXP_FLOOR_ARM_AT = 10;
const EXP_MAX_STACK_DEFAULT = 10; // overridden live by cfg.maxStack (exp_max_stack)
const EXP_QUICK_REVERSAL_FRACTION = 0.3;
const EXP_CANARY_PEAK = 5, EXP_CANARY_MIN_STACK = 3; // ver nota en trading-bot-v3.jsx junto a estas mismas constantes (v2: % de EXP_RETAIN_PCT, no rango fijo)
const SESSION_ID = `server:${process.env.FLY_MACHINE_ID || "local"}:${Math.random().toString(36).slice(2)}`;

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function posPnL(pos, price) {
  const dir = pos.type === "BUY" ? 1 : -1;
  return (dir * (price - pos.entry) / pos.entry) * pos.allocatedSize * (pos.multiplier || DEFAULT_MULTIPLIER);
}

async function getConfigValue(db, key, fallback) {
  try {
    const r = await db.query(`SELECT value FROM bot_config WHERE key = $1`, [key]);
    return r.rows[0]?.value ?? fallback;
  } catch { return fallback; }
}
async function setConfigValue(db, key, value) {
  try {
    await db.query(
      `INSERT INTO bot_config (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, String(value)]
    );
  } catch {}
}

export function startExpEngine() {
  const db = getPool();
  if (!db) { console.log("[exp-engine] DATABASE_URL not set — not starting"); return; }

  // Mutable engine state — plain module-level variables standing in for
  // what were React refs client-side.
  let candles = [];
  let price = null;
  let positions = [];
  let direction = null;
  let floor = -50;
  let addLevel = 0;
  let peak = 0;
  let lastPosPeak = 0; // pico propio de la ÚLTIMA posición apilada (canario)
  let isOwner = false;
  let cfg = { enabled: false, stake: 1, addStep: 50, floorStart: -50, maxStack: EXP_MAX_STACK_DEFAULT };
  let lastDbFloor = null, lastDbPosCount = -1;

  const log = (msg) => console.log(`[exp-engine] ${msg}`);

  const persistLive = async (force = false) => {
    const changed = floor !== lastDbFloor || positions.length !== lastDbPosCount;
    if (!force && !changed) return;
    lastDbFloor = floor; lastDbPosCount = positions.length;
    await setConfigValue(db, "exp_live_state", JSON.stringify({ positions, direction, floor, addLevel, peak }));
  };

  const addExpPos = async (type) => {
    if (!price || positions.length >= cfg.maxStack) return;
    const pos = { id: Date.now() + Math.random(), type, entry: price, allocatedSize: cfg.stake, multiplier: DEFAULT_MULTIPLIER, openTime: Date.now() };
    positions = [...positions, pos];
    lastPosPeak = 0; // nueva "última" posición — el canario arranca de cero para ella
    log(`${type} XAU/USD @ ${price.toFixed(2)} — pila ${positions.length}/${cfg.maxStack}`);
    await persistLive(true);
  };

  const closeAllExpPos = async (exitPrice, reason) => {
    const closed = positions.map(pos => ({
      ...pos, symbol: EXP_SYMBOL, exit: exitPrice, pnl: posPnL(pos, exitPrice), reason, closeTime: Date.now(),
    }));
    positions = [];
    await persistLive(true);
    for (const c of closed) {
      try {
        await db.query(
          `INSERT INTO exp_trades (symbol, type, entry_price, exit_price, pnl, reason, allocated_size, multiplier, opened_at, closed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [c.symbol, c.type, c.entry, c.exit, c.pnl, c.reason, c.allocatedSize, c.multiplier, new Date(c.openTime), new Date(c.closeTime)]
        );
      } catch (e) { log(`error writing exp_trades: ${e.message}`); }
    }
    return closed.reduce((s, c) => s + c.pnl, 0);
  };

  const resetStackTracking = () => { floor = cfg.floorStart; addLevel = 0; peak = 0; };

  const flip = async (exitPrice) => {
    const totalPnl = await closeAllExpPos(exitPrice, "FLIP");
    const opposite = direction === "BUY" ? "SELL" : "BUY";
    resetStackTracking();
    let note = "";
    if (totalPnl > 0) {
      floor = cfg.floorStart * EXP_QUICK_REVERSAL_FRACTION;
      note = ` · volteo rápido (piso ${floor.toFixed(2)})`;
    }
    log(`pila cerró en ${totalPnl.toFixed(2)} → voltea a ${opposite}${note}`);
    direction = opposite;
    await addExpPos(opposite);
  };

  const evaluateStack = async () => {
    if (!isOwner || !price || !positions.length) return;
    const stackPnl = positions.reduce((s, p) => s + posPnL(p, price), 0);
    peak = Math.max(peak, stackPnl);
    if (peak >= EXP_FLOOR_ARM_AT) floor = Math.max(floor, peak * EXP_RETAIN_PCT);
    // Canario: la ÚLTIMA posición apilada se revisa por separado (solo con
    // EXP_CANARY_MIN_STACK+ abiertas) — si su propio pico llega a
    // EXP_CANARY_PEAK y retrocede al mismo % de retención que ya usa el
    // piso agregado (EXP_RETAIN_PCT), voltea TODA la pila ya, sin esperar
    // al piso agregado (más lento porque las posiciones viejas, ya muy en
    // positivo, lo arrastran hacia arriba).
    if (positions.length >= EXP_CANARY_MIN_STACK) {
      const lastPos = positions.at(-1);
      const lastPnl = posPnL(lastPos, price);
      lastPosPeak = Math.max(lastPosPeak, lastPnl);
      if (lastPosPeak >= EXP_CANARY_PEAK) {
        const canaryFloor = lastPosPeak * EXP_RETAIN_PCT;
        if (lastPnl <= canaryFloor) {
          log(`canario — última posición tocó +${lastPosPeak.toFixed(2)} y cayó a ${lastPnl.toFixed(2)} (piso propio ${canaryFloor.toFixed(2)})`);
          await flip(price); return;
        }
      }
    }
    await persistLive();
    if (stackPnl <= floor) { await flip(price); return; }
    while (stackPnl >= addLevel + cfg.addStep && positions.length < cfg.maxStack) {
      addLevel += cfg.addStep;
      await addExpPos(direction);
    }
  };

  const onCandleClosed = async (prevCandle) => {
    if (!isOwner || positions.length > 0) return;
    const dir = prevCandle.c < prevCandle.o ? "SELL" : prevCandle.c > prevCandle.o ? "BUY" : null;
    if (!dir) return;
    direction = dir;
    resetStackTracking();
    await addExpPos(dir);
  };

  const claimOrCheckOwnership = async () => {
    try {
      const raw = (await getConfigValue(db, "exp_engine_owner", "")) || "";
      const [owner, hbStr] = raw.split(":");
      const hbAt = parseInt(hbStr, 10) || 0;
      const stale = !hbAt || (Date.now() - hbAt) > 15000;
      const mine = owner === SESSION_ID;
      if (!owner || mine || stale) {
        if (!isOwner) log("tomando el control del motor");
        isOwner = true;
        await setConfigValue(db, "exp_engine_owner", `${SESSION_ID}:${Date.now()}`);
      } else {
        if (isOwner) log("otra sesión tomó el control — pasando a solo lectura");
        isOwner = false;
        try {
          const live = JSON.parse((await getConfigValue(db, "exp_live_state", "null")) || "null");
          if (live) { positions = live.positions || []; direction = live.direction ?? null; if (live.floor != null) floor = live.floor; if (live.addLevel != null) addLevel = live.addLevel; if (live.peak != null) peak = live.peak; }
        } catch {}
      }
    } catch {}
  };

  const reloadConfig = async () => {
    const [enabled, stake, addStep, floorStart, maxStack] = await Promise.all([
      getConfigValue(db, "exp_enabled", "0"),
      getConfigValue(db, "exp_stake", "1"),
      getConfigValue(db, "exp_add_step", "50"),
      getConfigValue(db, "exp_floor_start", "-50"),
      getConfigValue(db, "exp_max_stack", "10"),
    ]);
    cfg = {
      enabled: enabled === "1", stake: parseFloat(stake) || 1, addStep: parseFloat(addStep) || 50,
      floorStart: parseFloat(floorStart) || -50, maxStack: parseInt(maxStack, 10) || 10,
    };
  };

  const fetchBinanceKlines = async (interval, limit) => {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${EXP_BINANCE}&interval=${interval}&limit=${limit}`);
    const raw = await r.json();
    if (!Array.isArray(raw)) return null;
    return raw.map(k => ({ time: Math.floor(k[0] / 1000), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));
  };

  let bootstrapped = false;
  const bootstrap = async () => {
    await reloadConfig();
    try {
      const live = JSON.parse((await getConfigValue(db, "exp_live_state", "null")) || "null");
      if (live?.positions?.length) {
        positions = live.positions; direction = live.direction ?? null;
        floor = live.floor ?? cfg.floorStart; addLevel = live.addLevel ?? 0; peak = live.peak ?? 0;
        log(`pila restaurada al iniciar (${positions.length}/${cfg.maxStack} ${direction}, piso ${floor.toFixed(2)})`);
      }
    } catch {}
    const k = await fetchBinanceKlines("1m", 300).catch(() => null);
    if (k?.length > 5) { candles = k; price = candles.at(-1).c; }
    bootstrapped = true;
    log(`motor iniciado (sesión ${SESSION_ID})`);
  };

  let ticking = false, tickStartedAt = 0, tickCount = 0;
  setInterval(async () => {
    const now = Date.now();
    if (ticking && (now - tickStartedAt) < 10000) return;
    ticking = true; tickStartedAt = now;
    try {
      if (!bootstrapped) { await bootstrap(); return; }
      tickCount++;
      if (tickCount % 5 === 0) { await reloadConfig(); await claimOrCheckOwnership(); }
      if (!cfg.enabled) return; // sin esto seguiría consultando Binance aunque el experimento esté apagado en la UI
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${EXP_BINANCE}`);
      const d = await r.json();
      const np = parseFloat(d.price);
      if (!np || isNaN(np)) return;
      price = np;
      const nowSec = Math.floor(Date.now() / 1000);
      if (candles.length) {
        const last = { ...candles[candles.length - 1] };
        if (nowSec - last.time >= 60) {
          candles = [...candles.slice(0, -1), last, { time: nowSec, o: np, c: np, h: np, l: np, v: 0 }];
          await onCandleClosed(last);
        } else {
          last.c = np; last.h = Math.max(last.h, np); last.l = Math.min(last.l, np);
          candles = [...candles.slice(0, -1), last];
        }
      }
      await evaluateStack();
    } catch (e) {
      console.error("[exp-engine] tick error:", e.message);
    } finally {
      ticking = false;
    }
  }, 1000);
}
