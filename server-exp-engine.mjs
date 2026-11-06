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
const EXP_HEDGE_TRIGGER_PCT = 0.5; // ver nota en trading-bot-v3.jsx
const SESSION_ID = `server:${process.env.FLY_MACHINE_ID || "local"}:${Math.random().toString(36).slice(2)}`;

// Ejecución real en Deriv (exp_deriv_live=1): SOLO este motor (servidor) la
// hace — el cliente (navegador) se niega a reclamar el motor mientras este
// modo esté activo (ver claimOrCheckOwnership en trading-bot-v3.jsx), así
// nunca hay dos instancias capaces de abrir/cerrar la MISMA posición real al
// mismo tiempo. El TP/SL que se le manda a Deriv al abrir es solo una RED DE
// SEGURIDAD muy amplia (nunca debería dispararse primero) — quien decide
// cuándo abrir/apilar/voltear sigue siendo exactamente la misma lógica de
// piso/pirámide/canario/cobertura de siempre; Deriv solo ejecuta la orden.
const DERIV_SAFETY_SL_MULT = 3; // múltiplo de |floorStart|
const DERIV_SAFETY_TP = 99999; // prácticamente nunca se alcanza por sí solo

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

// Llama al propio /api/deriv-order (mismo proceso, mismo puerto) — reusa el
// endpoint ya probado en producción en vez de hablar con Deriv directo desde
// aquí, para no duplicar la lógica de auth/OTP/REST que ya vive en ese archivo.
async function derivOrderCall(action, body) {
  const port = process.env.PORT || 8080;
  const r = await fetch(`http://127.0.0.1:${port}/api/deriv-order`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `deriv-order ${action} failed (${r.status})`);
  return data;
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
  let lastAddPrice = null; // precio de entrada de la ÚLTIMA posición apilada (exige movimiento real de precio antes de apilar otra)
  let hedge = null; // ver EXP_HEDGE_TRIGGER_PCT — null o UNA posición en la dirección contraria
  let isOwner = false;
  let cfg = { enabled: false, stake: 1, addStep: 50, floorStart: -50, maxStack: EXP_MAX_STACK_DEFAULT, derivLive: false };
  let lastDbFloor = null, lastDbPosCount = -1;
  let lastManualCloseAt = 0; // evita reprocesar la misma solicitud dos veces

  const log = (msg) => console.log(`[exp-engine] ${msg}`);

  const persistLive = async (force = false) => {
    const changed = floor !== lastDbFloor || positions.length !== lastDbPosCount;
    if (!force && !changed) return;
    lastDbFloor = floor; lastDbPosCount = positions.length;
    await setConfigValue(db, "exp_live_state", JSON.stringify({ positions, direction, floor, addLevel, peak, hedge }));
  };

  const writeTradeRecord = async (c) => {
    try {
      await db.query(
        `INSERT INTO exp_trades (symbol, type, entry_price, exit_price, pnl, reason, pattern, objetivo_pila, stop_pila, allocated_size, multiplier, opened_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [c.symbol, c.type, c.entry, c.exit, c.pnl, c.reason, c.pattern, c.objetivo, c.stop, c.allocatedSize, c.multiplier, new Date(c.openTime), new Date(c.closeTime)]
      );
    } catch (e) { log(`error writing exp_trades: ${e.message}`); }
  };

  const addExpPos = async (type, pattern = "VELA ANTERIOR") => {
    if (!price || positions.length >= cfg.maxStack) return;
    let pos = { id: Date.now() + Math.random(), type, entry: price, allocatedSize: cfg.stake, multiplier: DEFAULT_MULTIPLIER, openTime: Date.now(), pattern };
    if (cfg.derivLive) {
      try {
        const r = await derivOrderCall("open", {
          symbol: EXP_SYMBOL, side: type, stake: cfg.stake, multiplier: DEFAULT_MULTIPLIER,
          tpTarget: DERIV_SAFETY_TP, slTarget: Math.abs(cfg.floorStart) * DERIV_SAFETY_SL_MULT,
        });
        pos = { ...pos, contractId: r.contractId, derivBuyPrice: r.buyPrice };
        log(`Deriv: contrato ${r.contractId} abierto (${type}, stake ${cfg.stake})`);
      } catch (e) {
        log(`Deriv: ERROR abriendo ${type} — ${e.message} — NO se apila (se reintenta en el próximo tick)`);
        return; // sin posición local si Deriv falló — evita que diverja de la realidad
      }
    }
    positions = [...positions, pos];
    lastPosPeak = 0; // nueva "última" posición — el canario arranca de cero para ella
    lastAddPrice = price; // próxima apilada exige moverse desde ESTE precio, no desde el agregado
    log(`${type} XAU/USD @ ${price.toFixed(2)} — pila ${positions.length}/${cfg.maxStack}`);
    await persistLive(true);
  };

  // Cierra UNA posición (real en Deriv si tiene contractId, simulada si no).
  // ok:false significa "no se pudo confirmar el cierre, reintentar" — nunca
  // se descarta la posición localmente sin confirmar, para no divergir de lo
  // que de verdad hay abierto en Deriv.
  const closeOnePosition = async (pos, exitPrice, extra) => {
    if (pos.contractId) {
      try {
        const r = await derivOrderCall("close", { contractId: pos.contractId });
        const realPnl = (r.sellPrice ?? 0) - (pos.derivBuyPrice ?? pos.allocatedSize);
        return { ok: true, record: { ...pos, ...extra, exit: r.sellPrice ?? exitPrice, pnl: realPnl, closeTime: Date.now() } };
      } catch (e) {
        // Pudo haberse cerrado ya (reintento tras un fallo de red del intento
        // anterior) — antes de darlo por fallido, revisa el estado real en
        // Deriv (mismo patrón de reconciliación que ya usa el bot principal).
        try {
          const detail = await derivOrderCall("contract", { contractId: pos.contractId });
          if (detail.isSold) {
            const realPnl = detail.profit ?? ((detail.sellPrice ?? 0) - (pos.derivBuyPrice ?? pos.allocatedSize));
            return { ok: true, record: { ...pos, ...extra, exit: detail.exitSpot ?? exitPrice, pnl: realPnl, closeTime: detail.closeTime || Date.now() } };
          }
        } catch {}
        log(`Deriv: ERROR cerrando contrato ${pos.contractId} — ${e.message} — se reintenta`);
        return { ok: false };
      }
    }
    return { ok: true, record: { ...pos, ...extra, exit: exitPrice, pnl: posPnL(pos, exitPrice), closeTime: Date.now() } };
  };

  // allClosed:false dejó en `positions` SOLO las que no se pudieron cerrar —
  // el caller (flip/manualCloseAll) no debe voltear/resetear hasta que esto
  // dé allClosed:true, si no se pierde el rastro de un contrato real abierto.
  const closeAllExpPos = async (exitPrice, reason) => {
    // objetivo/stop de la pila en el momento EXACTO del cierre — hay que
    // leerlos ANTES de resetStackTracking (que se llama justo después en
    // flip()), si no quedarían en 0/piso-inicial para el histórico.
    const objetivo = addLevel + cfg.addStep;
    const stop = floor;
    const remaining = [], closedRecords = [];
    for (const pos of positions) {
      const { ok, record } = await closeOnePosition(pos, exitPrice, { symbol: EXP_SYMBOL, reason, objetivo, stop });
      if (ok) closedRecords.push(record); else remaining.push(pos);
    }
    positions = remaining;
    await persistLive(true);
    for (const c of closedRecords) await writeTradeRecord(c);
    return { totalPnl: closedRecords.reduce((s, c) => s + c.pnl, 0), allClosed: remaining.length === 0 };
  };

  const resetStackTracking = () => { floor = cfg.floorStart; addLevel = 0; peak = 0; };

  // Cierra la cobertura (si existe) junto con la pila principal — sin piso/
  // objetivo propio, vive y muere con el ciclo que la disparó (ver
  // EXP_HEDGE_TRIGGER_PCT en trading-bot-v3.jsx).
  const closeHedge = async (exitPrice) => {
    if (!hedge) return { pnl: 0, ok: true };
    const objetivo = addLevel + cfg.addStep;
    const stop = floor;
    const { ok, record } = await closeOnePosition(hedge, exitPrice, { symbol: EXP_SYMBOL, reason: "HEDGE", pattern: "COBERTURA", objetivo, stop });
    if (!ok) { log("Deriv: no se pudo confirmar el cierre de la cobertura — se reintenta"); return { pnl: 0, ok: false }; }
    hedge = null;
    await writeTradeRecord(record);
    log(`cobertura cerrada en ${record.pnl.toFixed(2)}`);
    return { pnl: record.pnl, ok: true };
  };

  const flip = async (exitPrice) => {
    const hedgeResult = await closeHedge(exitPrice);
    const stackResult = await closeAllExpPos(exitPrice, "FLIP");
    if (!hedgeResult.ok || !stackResult.allClosed) {
      log("volteo incompleto (alguna posición no se pudo cerrar en Deriv) — se reintenta en el próximo tick, sin voltear todavía");
      return;
    }
    const totalPnl = stackResult.totalPnl + hedgeResult.pnl;
    const opposite = direction === "BUY" ? "SELL" : "BUY";
    resetStackTracking();
    let note = "";
    if (totalPnl > 0) {
      floor = cfg.floorStart * EXP_QUICK_REVERSAL_FRACTION;
      note = ` · volteo rápido (piso ${floor.toFixed(2)})`;
    }
    log(`pila cerró en ${totalPnl.toFixed(2)} → voltea a ${opposite}${note}`);
    direction = opposite;
    await addExpPos(opposite, "VOLTEO");
  };

  // ── Cierre manual (botón "Cerrar"/"Cerrar todo" en la UI) ───────────────
  // A diferencia de flip(), NO reabre del lado contrario — deja la pila
  // plana y que onCandleClosed elija la próxima dirección con la siguiente
  // vela, como una intervención manual del usuario debe comportarse.
  const manualCloseAll = async (exitPrice) => {
    const hedgeResult = await closeHedge(exitPrice);
    const stackResult = await closeAllExpPos(exitPrice, "MANUAL");
    if (!hedgeResult.ok || !stackResult.allClosed) { log("cierre manual incompleto — se reintenta"); return false; }
    resetStackTracking();
    direction = null;
    log(`cierre manual de toda la pila — cerró en ${(stackResult.totalPnl + hedgeResult.pnl).toFixed(2)}`);
    return true;
  };

  // posId identifica la posición por su `id` local (toda posición lo tiene,
  // simulada o real) — no por contractId, que solo existe para las reales.
  const manualCloseOne = async (posId, exitPrice) => {
    if (hedge?.id === posId) return (await closeHedge(exitPrice)).ok;
    const pos = positions.find(p => p.id === posId);
    if (!pos) { log(`cierre manual: posición ${posId} ya no está en la pila`); return true; }
    const objetivo = addLevel + cfg.addStep, stop = floor;
    const { ok, record } = await closeOnePosition(pos, exitPrice, { symbol: EXP_SYMBOL, reason: "MANUAL", objetivo, stop });
    if (!ok) return false;
    positions = positions.filter(p => p.id !== posId);
    await persistLive(true);
    await writeTradeRecord(record);
    log(`cierre manual de 1 posición — pnl ${record.pnl.toFixed(2)} — pila ${positions.length}/${cfg.maxStack}`);
    return true;
  };

  const evaluateStack = async () => {
    if (!isOwner || !price || !positions.length) return;
    const stackPnl = positions.reduce((s, p) => s + posPnL(p, price), 0);
    peak = Math.max(peak, stackPnl);
    if (peak >= EXP_FLOOR_ARM_AT) floor = Math.max(floor, peak * EXP_RETAIN_PCT);
    // Cobertura: la pila NUNCA estuvo en positivo (peak sigue en 0) y la
    // pérdida agregada ya llega al 50% de cfg.floorStart — abre UNA
    // posición en la dirección contraria, mismo stake, aparte de la pila.
    if (!hedge && peak === 0 && stackPnl <= cfg.floorStart * EXP_HEDGE_TRIGGER_PCT) {
      const hedgeType = direction === "BUY" ? "SELL" : "BUY";
      let h = { id: Date.now() + Math.random(), type: hedgeType, entry: price, allocatedSize: cfg.stake, multiplier: DEFAULT_MULTIPLIER, openTime: Date.now(), pattern: "COBERTURA" };
      if (cfg.derivLive) {
        try {
          const r = await derivOrderCall("open", {
            symbol: EXP_SYMBOL, side: hedgeType, stake: cfg.stake, multiplier: DEFAULT_MULTIPLIER,
            tpTarget: DERIV_SAFETY_TP, slTarget: Math.abs(cfg.floorStart) * DERIV_SAFETY_SL_MULT,
          });
          h = { ...h, contractId: r.contractId, derivBuyPrice: r.buyPrice };
          log(`Deriv: contrato ${r.contractId} abierto (cobertura ${hedgeType}, stake ${cfg.stake})`);
        } catch (e) {
          log(`Deriv: ERROR abriendo cobertura — ${e.message} — se reintenta en el próximo tick`);
          return; // sin cobertura local si Deriv falló — evita divergencia
        }
      }
      hedge = h;
      log(`cobertura ${hedgeType} abierta @ ${price.toFixed(2)} (pila en ${stackPnl.toFixed(2)})`);
      await persistLive(true);
    }
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
    // Apilar otra posición exige que el PRECIO se haya movido de verdad
    // desde la entrada de la ÚLTIMA apilada, no que la SUMA agregada haya
    // cruzado otro escalón (ver nota completa en trading-bot-v3.jsx) — con
    // posiciones viejas ya ganando fuerte, el agregado sigue creciendo
    // aunque el precio esté quieto, así que el chequeo por suma seguía
    // apilando varias al mismo precio en ticks separados.
    const priceStepPct = cfg.addStep / (cfg.stake * DEFAULT_MULTIPLIER);
    const movedEnough = lastAddPrice != null && (
      direction === "BUY" ? price >= lastAddPrice * (1 + priceStepPct) : price <= lastAddPrice * (1 - priceStepPct)
    );
    if (movedEnough && positions.length < cfg.maxStack) {
      addLevel += cfg.addStep; // solo informativo para la UI (OBJETIVO PILA)
      await addExpPos(direction, "PIRÁMIDE");
    }
  };

  const onCandleClosed = async (prevCandle) => {
    if (!isOwner || positions.length > 0) return;
    const dir = prevCandle.c < prevCandle.o ? "SELL" : prevCandle.c > prevCandle.o ? "BUY" : null;
    if (!dir) return;
    direction = dir;
    resetStackTracking();
    await addExpPos(dir, "VELA ANTERIOR");
  };

  const claimOrCheckOwnership = async () => {
    try {
      const raw = (await getConfigValue(db, "exp_engine_owner", "")) || "";
      const [owner, hbStr] = raw.split(":");
      const hbAt = parseInt(hbStr, 10) || 0;
      const stale = !hbAt || (Date.now() - hbAt) > 15000;
      const mine = owner === SESSION_ID;
      if (!owner || mine || stale) {
        if (!isOwner) {
          log("tomando el control del motor");
          // Otra sesión pudo haber mutado positions/floor/peak/hedge mientras
          // nosotros no éramos dueños — si seguimos con lo que teníamos en
          // memoria de ANTES de perder el control, evaluamos contra un
          // estado viejo (piso/pila que ya no son los reales) y la pila
          // puede pasar de largo su piso real. Resincroniza desde la DB
          // antes de volver a evaluar.
          try {
            const live = JSON.parse((await getConfigValue(db, "exp_live_state", "null")) || "null");
            if (live) {
              positions = live.positions || []; direction = live.direction ?? null;
              if (live.floor != null) floor = live.floor;
              if (live.addLevel != null) addLevel = live.addLevel;
              if (live.peak != null) peak = live.peak;
              hedge = live.hedge ?? null;
            }
          } catch {}
        }
        isOwner = true;
        await setConfigValue(db, "exp_engine_owner", `${SESSION_ID}:${Date.now()}`);
      } else {
        if (isOwner) log("otra sesión tomó el control — pasando a solo lectura");
        isOwner = false;
        try {
          const live = JSON.parse((await getConfigValue(db, "exp_live_state", "null")) || "null");
          if (live) { positions = live.positions || []; direction = live.direction ?? null; if (live.floor != null) floor = live.floor; if (live.addLevel != null) addLevel = live.addLevel; if (live.peak != null) peak = live.peak; hedge = live.hedge ?? null; }
        } catch {}
      }
    } catch {}
  };

  const reloadConfig = async () => {
    const [enabled, stake, addStep, floorStart, maxStack, derivLive] = await Promise.all([
      getConfigValue(db, "exp_enabled", "0"),
      getConfigValue(db, "exp_stake", "1"),
      getConfigValue(db, "exp_add_step", "50"),
      getConfigValue(db, "exp_floor_start", "-50"),
      getConfigValue(db, "exp_max_stack", "10"),
      getConfigValue(db, "exp_deriv_live", "0"),
    ]);
    const wasLive = cfg.derivLive;
    cfg = {
      enabled: enabled === "1", stake: parseFloat(stake) || 1, addStep: parseFloat(addStep) || 50,
      floorStart: parseFloat(floorStart) || -50, maxStack: parseInt(maxStack, 10) || 10,
      derivLive: derivLive === "1",
    };
    if (cfg.derivLive && !wasLive) log("⚠️ MODO EN VIVO (Deriv demo) activado — las próximas posiciones serán contratos reales");
    if (!cfg.derivLive && wasLive) log("Modo en vivo (Deriv) desactivado — vuelve a simulado");
  };

  // ── Comando manual (botón "Cerrar"/"Cerrar todo" en la UI) ──────────────
  // Igual que reloadConfig/claimOrCheckOwnership, se revisa por polling (un
  // valor en bot_config) en vez de un canal directo — consistente con cómo
  // ya se maneja todo lo demás en este motor, y evita necesitar un socket.
  const checkManualCloseRequest = async () => {
    if (!isOwner) return;
    let req;
    try { req = JSON.parse((await getConfigValue(db, "exp_manual_close_request", "null")) || "null"); } catch { return; }
    if (!req || !req.requestedAt || req.requestedAt <= lastManualCloseAt) return;
    if (Date.now() - req.requestedAt > 30000) { lastManualCloseAt = req.requestedAt; return; } // solicitud vieja, ignorar
    if (!price) return; // sin precio todavía no se puede valorar el cierre
    lastManualCloseAt = req.requestedAt;
    log(`solicitud manual recibida: ${req.type === "all" ? "cerrar TODO" : `cerrar posición ${req.posId}`}`);
    if (req.type === "all") await manualCloseAll(price);
    else if (req.type === "one" && req.posId != null) await manualCloseOne(req.posId, price);
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
        hedge = live.hedge ?? null;
        log(`pila restaurada al iniciar (${positions.length}/${cfg.maxStack} ${direction}, piso ${floor.toFixed(2)}${hedge?" · cobertura "+hedge.type:""})`);
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
      // El precio se actualiza SIEMPRE (lo necesita el cierre manual aunque
      // el experimento esté pausado) — lo que si se salta cuando está
      // apagado es la lógica automática de entrada/apilado/volteo. Antes
      // esto estaba todo detrás de "if (!cfg.enabled) return", lo que
      // dejaba el botón "Cerrar"/"Cerrar todo" sin efecto mientras el
      // experimento estuviera apagado — reportado en vivo.
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${EXP_BINANCE}`);
      const d = await r.json();
      const np = parseFloat(d.price);
      if (np && !isNaN(np)) {
        price = np;
        if (cfg.enabled) {
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
        }
      }
      await checkManualCloseRequest();
    } catch (e) {
      console.error("[exp-engine] tick error:", e.message);
    } finally {
      ticking = false;
    }
  }, 1000);
}
