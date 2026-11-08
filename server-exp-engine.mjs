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

const EXP_SYMBOL_DEFAULT = "XAU/USD"; // ver cfg.symbol (editable en vivo vía exp_symbol) — reemplaza al antiguo EXP_SYMBOL fijo
// Símbolo soportado -> symbol de Deriv para la acción "tick" (precio) y para
// "open"/"close" (ver SYMBOL_MAP en api/deriv-order.js, que debe tener la
// misma entrada). BTC/USD agregado explícitamente para poder seguir
// probando el motor (simulado) mientras XAU/USD está cerrado por fin de
// semana/feriado — cripto opera 24/7, el símbolo verificado en vivo vía
// "tick" antes de registrarlo (cryBTCUSD devolvió un precio real).
const EXP_SYMBOL_TICK = { "XAU/USD": "frxXAUUSD", "BTC/USD": "cryBTCUSD" };
const DEFAULT_MULTIPLIER = 100;
const EXP_RETAIN_PCT = 0.8;
const EXP_FLOOR_ARM_AT = 10;
const EXP_MAX_STACK_DEFAULT = 10; // overridden live by cfg.maxStack (exp_max_stack)
const EXP_QUICK_REVERSAL_FRACTION = 0.3;
const EXP_CANARY_PEAK = 5, EXP_CANARY_MIN_STACK = 3; // ver nota en trading-bot-v3.jsx junto a estas mismas constantes (v2: % de EXP_RETAIN_PCT, no rango fijo)
const EXP_HEDGE_TRIGGER_PCT = 0.5; // ver nota en trading-bot-v3.jsx
const EXP_HEDGE_STOP_PCT = 1; // SL propio de la cobertura: se cierra SOLA si su pérdida llega al mismo piso inicial de la pila (cfg.floorStart) — antes nada la detenía si la pila principal se recuperaba a positivo (la cobertura, al ir en la dirección contraria, queda entonces del lado perdedor) y tardaba en tocar SU propio piso para voltear
const SESSION_ID = `server:${process.env.FLY_MACHINE_ID || "local"}:${Math.random().toString(36).slice(2)}`;

// Ejecución real en Deriv (exp_deriv_live=1): SOLO este motor (servidor) la
// hace — el cliente (navegador) se niega a reclamar el motor mientras este
// modo esté activo (ver claimOrCheckOwnership en trading-bot-v3.jsx), así
// nunca hay dos instancias capaces de abrir/cerrar la MISMA posición real al
// mismo tiempo. El TP/SL que se le manda a Deriv al abrir es solo una RED DE
// SEGURIDAD muy amplia (nunca debería dispararse primero) — quien decide
// cuándo abrir/apilar/voltear sigue siendo exactamente la misma lógica de
// piso/pirámide/canario/cobertura de siempre; Deriv solo ejecuta la orden.
// Probado en vivo (binary search contra la cuenta demo real) para entender
// los topes reales de Deriv en limit_order de Multiplicadores en Gold/USD —
// NINGUNA combinación grande funcionaba, y el modo en vivo nunca llegó a
// abrir nada desde que se activó:
//   tp=1,  sl=1 (ambos = stake)         → OK
//   tp=2000, sl=3 (stake=1)             → RECHAZADO: "equal to or lower than 50.00" (tope de TP)
//   tp=50, sl=3 (stake=1)               → RECHAZADO: "equal to or lower than 1.00" (SL no puede superar el stake)
// Conclusión: el SL no puede pasar del stake (tiene sentido — un
// Multiplicador ya se detiene solo cerca del 100% de pérdida del stake,
// pedirle un stop_loss más grande que eso no es válido) y el TP tiene un
// tope aparte, fijo, de ~$50 (no depende del stake) — se deja bien por
// debajo de ambos.
const DERIV_SAFETY_TP = 40;
const derivSafetySL = (stake) => stake;

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
  let cfg = { enabled: false, stake: 1, addStep: 50, floorStart: -50, maxStack: EXP_MAX_STACK_DEFAULT, derivLive: false, symbol: EXP_SYMBOL_DEFAULT };
  let lastDbFloor = null, lastDbPosCount = -1;
  let lastManualCloseAt = 0; // evita reprocesar la misma solicitud dos veces

  const log = (msg) => console.log(`[exp-engine] ${msg}`);

  const persistLive = async (force = false) => {
    const changed = floor !== lastDbFloor || positions.length !== lastDbPosCount;
    if (!force && !changed) return;
    lastDbFloor = floor; lastDbPosCount = positions.length;
    // lastAddPrice/lastPosPeak van AQUÍ también — no son solo refs internas
    // de exhibición. Antes NO se persistían: si el dueño del motor cambiaba
    // a mitad de ciclo (pasa seguido, servidor y cliente compiten por el
    // control), el lado nuevo heredaba positions/floor/peak correctos pero
    // lastAddPrice quedaba en null — y el gate de apilado (`lastAddPrice !=
    // null && ...`) se queda bloqueado PARA SIEMPRE mientras ese lado sea
    // dueño, aunque el precio seguiera moviéndose a favor. Reportado en
    // vivo: "pasó muy rápido de negativo a positivo y no activó las otras"
    // — la pila se quedó en 3/10 mientras el precio seguía subiendo.
    await setConfigValue(db, "exp_live_state", JSON.stringify({ positions, direction, floor, addLevel, peak, hedge, lastAddPrice, lastPosPeak }));
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
    // symbol se graba EN LA POSICIÓN al abrir (no solo al cerrar) — defensa
    // extra ante el bug real que pasó en vivo: cfg.symbol cambió mientras
    // una posición de otro símbolo seguía abierta, y evaluateStack calculó
    // PnL mezclando el precio nuevo contra la entrada vieja (ver guard en
    // reloadConfig/bootstrap). Con esto, aunque ese guard fallara, cualquier
    // posición puede verificar contra QUÉ símbolo se abrió de verdad.
    let pos = { id: Date.now() + Math.random(), type, entry: price, allocatedSize: cfg.stake, multiplier: DEFAULT_MULTIPLIER, openTime: Date.now(), pattern, symbol: cfg.symbol };
    if (cfg.derivLive) {
      try {
        const r = await derivOrderCall("open", {
          symbol: cfg.symbol, side: type, stake: cfg.stake, multiplier: DEFAULT_MULTIPLIER,
          tpTarget: DERIV_SAFETY_TP, slTarget: derivSafetySL(cfg.stake),
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
    log(`${type} ${cfg.symbol} @ ${price.toFixed(2)} — pila ${positions.length}/${cfg.maxStack}`);
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
        // r.sellPrice es "sold_for" — el VALOR EN DÓLARES del contrato (lo
        // que se recupera, comparable a buyPrice/stake), NO el precio de
        // mercado del oro. Usarlo como "exit" daba números como "691.94"
        // en vez de "~4067" y un % sin sentido (-82%, +83%) — reportado en
        // vivo. El pnl real (sold_for - buy_price) sí está bien así. El
        // precio de mercado real usa exitPrice (nuestro propio feed de
        // Deriv, el mismo que decidió cerrar) — consultarle a Deriv el
        // exit_spot exacto añadiría otra llamada completa, justo la
        // latencia que se está tratando de recortar.
        const realPnl = (r.sellPrice ?? 0) - (pos.derivBuyPrice ?? pos.allocatedSize);
        return { ok: true, record: { ...pos, ...extra, exit: exitPrice, pnl: realPnl, closeTime: Date.now() } };
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
    // EN PARALELO, no en serie — cerrarlas una por una (await dentro de un
    // for) con una pila de 5 posiciones podía sumar 2.5-3.5s solo para
    // cerrar (5 × ~0.5-0.7s cada llamada a Deriv), justo el "bajonazo"
    // reportado en vivo durante un volteo con la pila llena.
    // symbol: el de la POSICIÓN (grabado al abrirla), no cfg.symbol actual —
    // si cfg.symbol cambió entre que se abrió y que se cierra (no debería,
    // el guard lo impide, pero esto es la red de seguridad real), el
    // registro histórico queda con el símbolo correcto de todas formas.
    const results = await Promise.all(
      positions.map(pos => closeOnePosition(pos, exitPrice, { symbol: pos.symbol || cfg.symbol, reason, objetivo, stop }))
    );
    const remaining = [], closedRecords = [];
    results.forEach(({ ok, record }, i) => { if (ok) closedRecords.push(record); else remaining.push(positions[i]); });
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
    const { ok, record } = await closeOnePosition(hedge, exitPrice, { symbol: hedge.symbol || cfg.symbol, reason: "HEDGE", pattern: "COBERTURA", objetivo, stop });
    if (!ok) { log("Deriv: no se pudo confirmar el cierre de la cobertura — se reintenta"); return { pnl: 0, ok: false }; }
    hedge = null;
    // persistLive() normal solo detecta cambios de floor/cantidad de
    // posiciones — hedge puede pasar a null sin que ninguno de esos dos
    // cambie (p.ej. cerrada sola por su propio SL), así que se fuerza aquí
    // para no dejar el hedge persistido como "abierto" cuando ya no lo está.
    await persistLive(true);
    await writeTradeRecord(record);
    log(`cobertura cerrada en ${record.pnl.toFixed(2)}`);
    return { pnl: record.pnl, ok: true };
  };

  const flip = async (exitPrice) => {
    // Si hay cobertura abierta y en ESE momento viene ganando, no se cierra
    // — se absorbe como la primera posición de la pila volteada (misma
    // dirección que la cobertura, que es justo la dirección que el precio
    // acaba de demostrar). Antes se cerraban pila Y cobertura juntas y se
    // abría una posición nueva idéntica desde cero: 2 llamadas a Deriv de
    // más y, sobre todo, se "reseteaba" una posición que ya iba en positivo
    // justo cuando el precio ya probó ir en esa dirección — pedido
    // explícito: seguir el ciclo desde esa positiva sin cerrarla, y apilar
    // más solo cuando el precio avance el OBJETIVO PILA normal desde aquí.
    const hedgePnlNow = hedge ? posPnL(hedge, exitPrice) : 0;
    if (hedge && hedgePnlNow > 0) {
      const stackResult = await closeAllExpPos(exitPrice, "FLIP");
      if (!stackResult.allClosed) {
        log("volteo incompleto (alguna posición no se pudo cerrar en Deriv) — se reintenta en el próximo tick, sin voltear todavía");
        return;
      }
      const combinedPnl = stackResult.totalPnl + hedgePnlNow;
      const absorbed = hedge;
      resetStackTracking();
      positions = [absorbed];
      hedge = null;
      direction = absorbed.type;
      lastPosPeak = 0;
      lastAddPrice = exitPrice;
      let note = " · cobertura ganadora absorbida como nueva pila (sigue abierta)";
      if (combinedPnl > 0) {
        floor = cfg.floorStart * EXP_QUICK_REVERSAL_FRACTION;
        note += ` · piso ${floor.toFixed(2)}`;
      }
      log(`pila cerró en ${stackResult.totalPnl.toFixed(2)} (cobertura seguía en +${hedgePnlNow.toFixed(2)}) → continúa como ${direction}${note}`);
      await persistLive(true);
      return;
    }

    // Cobertura y pila son independientes — cerrarlas en paralelo en vez de
    // una tras otra ahorra otro medio segundo en el momento más crítico.
    const [hedgeResult, stackResult] = await Promise.all([closeHedge(exitPrice), closeAllExpPos(exitPrice, "FLIP")]);
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
    const [hedgeResult, stackResult] = await Promise.all([closeHedge(exitPrice), closeAllExpPos(exitPrice, "MANUAL")]);
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
    const { ok, record } = await closeOnePosition(pos, exitPrice, { symbol: pos.symbol || cfg.symbol, reason: "MANUAL", objetivo, stop });
    if (!ok) return false;
    positions = positions.filter(p => p.id !== posId);
    await persistLive(true);
    await writeTradeRecord(record);
    log(`cierre manual de 1 posición — pnl ${record.pnl.toFixed(2)} — pila ${positions.length}/${cfg.maxStack}`);
    return true;
  };

  const evaluateStack = async () => {
    if (!isOwner || !price || !positions.length) return;
    // Red de seguridad real: pasó en vivo que cfg.symbol cambió con una
    // posición de OTRO símbolo todavía abierta (bug de orden en bootstrap,
    // ya corregido) y esto calculó PnL mezclando el precio nuevo contra una
    // entrada vieja de otro símbolo — números absurdos que dispararon un
    // volteo en bucle. Si algo abierto no coincide con cfg.symbol, no se
    // evalúa NADA hasta que se resuelva (ver checkManualCloseRequest, que
    // sigue permitiendo cerrarla a mano).
    const mismatched = positions.find(p => p.symbol && p.symbol !== cfg.symbol);
    if (mismatched || (hedge?.symbol && hedge.symbol !== cfg.symbol)) {
      log(`⚠️ hay posiciones abiertas en un símbolo distinto a cfg.symbol (${cfg.symbol}) — se detiene evaluateStack hasta resolverlo`);
      return;
    }
    const stackPnl = positions.reduce((s, p) => s + posPnL(p, price), 0);
    peak = Math.max(peak, stackPnl);
    if (peak >= EXP_FLOOR_ARM_AT) floor = Math.max(floor, peak * EXP_RETAIN_PCT);
    // Cobertura: la pila NUNCA estuvo en positivo (peak sigue en 0) y la
    // pérdida agregada ya llega al 50% de cfg.floorStart — abre UNA
    // posición en la dirección contraria, mismo stake, aparte de la pila.
    if (!hedge && peak === 0 && stackPnl <= cfg.floorStart * EXP_HEDGE_TRIGGER_PCT) {
      const hedgeType = direction === "BUY" ? "SELL" : "BUY";
      let h = { id: Date.now() + Math.random(), type: hedgeType, entry: price, allocatedSize: cfg.stake, multiplier: DEFAULT_MULTIPLIER, openTime: Date.now(), pattern: "COBERTURA", symbol: cfg.symbol };
      if (cfg.derivLive) {
        try {
          const r = await derivOrderCall("open", {
            symbol: cfg.symbol, side: hedgeType, stake: cfg.stake, multiplier: DEFAULT_MULTIPLIER,
            tpTarget: DERIV_SAFETY_TP, slTarget: derivSafetySL(cfg.stake),
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
    // SL propio de la cobertura — independiente del piso de la pila
    // principal. Sin esto, si la pila principal empieza a recuperarse
    // (vuelve a positivo) la cobertura queda del lado perdedor y nada la
    // detiene hasta que la pila principal voltee por SU cuenta, lo que
    // puede tardar mucho. Se cierra sola en cuanto su propia pérdida
    // llega al mismo piso inicial (cfg.floorStart) que usa la pila.
    if (hedge) {
      const hedgePnl = posPnL(hedge, price);
      if (hedgePnl <= cfg.floorStart * EXP_HEDGE_STOP_PCT) {
        log(`cobertura tocó su propio stop (${hedgePnl.toFixed(2)}) — se cierra sola`);
        await closeHedge(price);
      }
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
    // Canario inmediato: el de arriba exige que la última posición PRIMERO
    // haya llegado a +$5 antes de voltear por su retroceso — con piso/paso
    // chicos (pedido explícito de probar ganancias de centavos), la última
    // casi nunca llega a esos +$5 antes de girar, así que esa protección no
    // alcanza a activarse y las posiciones VIEJAS, ya ganando fuerte,
    // esconden la reversión en el agregado durante un rato. Reportado en
    // vivo con datos reales: una pila de 5 cerró junta en -$67.63 pese a
    // tener una posición ganadora adentro — "es importante que el último
    // siempre detecte que bajó y cierre todo". Si la ÚLTIMA posición SOLA
    // ya perdió tanto como el piso configurado, voltea ya, sin esperar a
    // que el agregado (con las viejas ganadoras pesando) también lo cruce.
    // No evita la pérdida de un salto de precio que ocurre DENTRO del
    // mismo segundo entre un chequeo y el siguiente (límite real de
    // revisar por sondeo, no de esta regla) — sí reacciona más rápido
    // cuando el giro no es instantáneo.
    // IMPORTANTE: contra cfg.floorStart (PISO INICIAL, fijo), NO contra
    // `floor` (que puede haber subido a POSITIVO una vez el pico arma el
    // piso dinámico) — pedido explícito tras encontrar el bug en vivo: con
    // `floor` ya en +$51, CUALQUIER posición recién apilada (pnl ~0) habría
    // cumplido "0 <= 51" y volteado TODA la pila ganadora en el siguiente
    // apilado, justo cuando más protección de ganancia hacía falta.
    if (positions.length >= 2) {
      const lastPnlNow = posPnL(positions.at(-1), price);
      if (lastPnlNow <= cfg.floorStart) {
        log(`canario inmediato — la última posición sola ya perdió ${lastPnlNow.toFixed(2)} (piso inicial ${cfg.floorStart.toFixed(2)}) — voltea sin esperar al agregado`);
        await flip(price); return;
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
              lastAddPrice = live.lastAddPrice ?? null; lastPosPeak = live.lastPosPeak ?? 0;
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
          if (live) {
            positions = live.positions || []; direction = live.direction ?? null;
            if (live.floor != null) floor = live.floor;
            if (live.addLevel != null) addLevel = live.addLevel;
            if (live.peak != null) peak = live.peak;
            hedge = live.hedge ?? null;
            lastAddPrice = live.lastAddPrice ?? null; lastPosPeak = live.lastPosPeak ?? 0;
          }
        } catch {}
      }
    } catch {}
  };

  const reloadConfig = async () => {
    const [enabled, stake, addStep, floorStart, maxStack, derivLive, symbol] = await Promise.all([
      getConfigValue(db, "exp_enabled", "0"),
      getConfigValue(db, "exp_stake", "1"),
      getConfigValue(db, "exp_add_step", "50"),
      getConfigValue(db, "exp_floor_start", "-50"),
      getConfigValue(db, "exp_max_stack", "10"),
      getConfigValue(db, "exp_deriv_live", "0"),
      getConfigValue(db, "exp_symbol", EXP_SYMBOL_DEFAULT),
    ]);
    const wasLive = cfg.derivLive;
    const wasSymbol = cfg.symbol;
    // El símbolo real lo manda lo que YA está abierto (posición u hedge),
    // no ciegamente exp_symbol — si hay algo abierto, cfg.symbol se fija al
    // símbolo CON el que se abrió, sin importar qué pida exp_symbol; evita
    // mezclar el precio de un símbolo nuevo con la entrada de una posición
    // abierta en OTRO símbolo (daría un PnL/piso basura, ej. entrada ~4065
    // de oro contra un precio ~76000 de BTC — pasó en vivo).
    // Antes esto bloqueaba CUALQUIER cambio mientras hubiera algo abierto,
    // incluso cuando el símbolo pedido YA coincidía con el de lo abierto —
    // en una instancia standby (2 máquinas Fly corren este motor; solo una
    // es dueña a la vez) que recién sincroniza una pila ya abierta en BTC,
    // esa condición nunca se volvía falsa (siempre había algo abierto en
    // cuanto se sincronizaba) y la instancia quedaba PERMANENTEMENTE
    // atascada en el símbolo viejo — reportado en vivo: exp_live_price
    // nunca dejaba de publicar el precio congelado del oro (mercado cerrado
    // el fin de semana) aun con exp_symbol en BTC/USD y la pila real ya en
    // BTC. Ahora solo bloquea si lo abierto es de verdad OTRO símbolo.
    const requestedSymbol = EXP_SYMBOL_TICK[symbol] ? symbol : EXP_SYMBOL_DEFAULT;
    const openSymbol = positions[0]?.symbol || hedge?.symbol || null;
    const resolvedSymbol = (openSymbol && EXP_SYMBOL_TICK[openSymbol]) ? openSymbol : requestedSymbol;
    cfg = {
      enabled: enabled === "1", stake: parseFloat(stake) || 1, addStep: parseFloat(addStep) || 50,
      floorStart: parseFloat(floorStart) || -50, maxStack: parseInt(maxStack, 10) || 10,
      derivLive: derivLive === "1",
      symbol: resolvedSymbol,
    };
    if (cfg.derivLive && !wasLive) log("⚠️ MODO EN VIVO (Deriv demo) activado — las próximas posiciones serán contratos reales");
    if (!cfg.derivLive && wasLive) log("Modo en vivo (Deriv) desactivado — vuelve a simulado");
    if (resolvedSymbol !== requestedSymbol) log(`⚠️ exp_symbol pide ${requestedSymbol} pero hay algo abierto en ${resolvedSymbol} — se mantiene ${resolvedSymbol} hasta que esa pila cierre`);
    else if (cfg.symbol !== wasSymbol) log(`símbolo del Experimento cambiado a ${cfg.symbol}`);
  };

  // El pnl/precio que YA mostramos para una posición real se calculaba 100%
  // local (nuestro propio tick + entry), distinto de lo que Deriv reporta de
  // verdad (su propio mark price + comisión acumulada) — reportado en vivo:
  // nuestra tabla mostraba +9.52 mientras la app de Deriv mostraba -0.33
  // para el MISMO contrato. Esto trae el profit/spot reales de Deriv (una
  // sola llamada a "portfolio" cubre TODOS los contratos abiertos de la
  // cuenta) y los deja en cada posición (derivProfit/derivSpot) para que el
  // cliente los muestre en vez de su propio estimado.
  const syncDerivProfits = async () => {
    if (!cfg.derivLive) return;
    const openContractIds = [...positions, ...(hedge ? [hedge] : [])].map(p => p.contractId).filter(Boolean);
    if (!openContractIds.length) return;
    try {
      const { positions: real } = await derivOrderCall("portfolio", {});
      const byId = new Map(real.map(c => [c.contractId, c]));
      let changed = false;
      positions = positions.map(p => {
        const c = p.contractId && byId.get(p.contractId);
        if (!c) return p;
        changed = true;
        return { ...p, derivProfit: c.profit, derivSpot: c.currentSpot };
      });
      if (hedge?.contractId && byId.get(hedge.contractId)) {
        const c = byId.get(hedge.contractId);
        hedge = { ...hedge, derivProfit: c.profit, derivSpot: c.currentSpot };
        changed = true;
      }
      if (changed) await persistLive(true);
    } catch (e) { log(`Deriv: error sincronizando profit real — ${e.message}`); }
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
    // OJO: lastManualCloseAt solo se marca si el cierre REALMENTE tuvo éxito
    // — si falla (ej. Deriv rate-limited, un error de red), la MISMA
    // solicitud se reintenta en el siguiente tick (cada ~1s) hasta lograrlo
    // o hasta que pasen los 30s de arriba. Antes se marcaba como "vista" en
    // el primer intento sin importar el resultado, así que un solo fallo
    // temporal dejaba el botón sin efecto para siempre.
    log(`solicitud manual recibida: ${req.type === "all" ? "cerrar TODO" : `cerrar posición ${req.posId}`}`);
    const ok = req.type === "all" ? await manualCloseAll(price)
      : (req.type === "one" && req.posId != null) ? await manualCloseOne(req.posId, price)
      : true;
    if (ok) lastManualCloseAt = req.requestedAt;
  };

  // Precio: Deriv (vía el mismo canal REST+OTP autenticado que ya usa el
  // Experimento para operar), NO Binance. Binance empezó a bloquear la IP de
  // esta máquina de Fly.io ("Service unavailable from a restricted
  // location" — dfw/Dallas cae bajo la restricción geográfica de
  // Binance.com) — el motor entero quedó congelado en silencio (price
  // nunca se seteaba, ni el auto-trading ni el cierre manual podían
  // evaluar nada) hasta diagnosticarlo con logs explícitos. Deriv no tiene
  // ese bloqueo desde esta misma máquina (ya verificado en vivo), y de
  // paso unifica la fuente de precio de DECISIÓN con la de EJECUCIÓN real.
  // Símbolo dinámico (cfg.symbol vía EXP_SYMBOL_TICK) — ya no fijo a oro.
  const fetchExpTickPrice = async () => {
    try {
      const derivSymbol = EXP_SYMBOL_TICK[cfg.symbol] || EXP_SYMBOL_TICK[EXP_SYMBOL_DEFAULT];
      const r = await derivOrderCall("tick", { derivSymbol });
      return typeof r.price === "number" ? r.price : null;
    } catch { return null; }
  };

  let bootstrapped = false;
  const bootstrap = async () => {
    // Restaura ANTES de reloadConfig() — el guard de cambio de símbolo ahí
    // decide mirando `positions`/`hedge` en memoria, y en el arranque siguen
    // vacíos (los valores iniciales de las variables del módulo) hasta que
    // esto corre. Si reloadConfig() fuera primero, el guard vería la pila
    // vacía y dejaría pasar un cambio de símbolo aunque hubiera una posición
    // real abierta en OTRO símbolo esperando a ser restaurada — pasó en
    // vivo: cfg.symbol saltó a BTC/USD con una posición de ORO real todavía
    // por restaurar, y evaluateStack calculó PnL mezclando precio de BTC
    // contra entrada de ORO (número absurdo que disparó flip() en bucle).
    try {
      const live = JSON.parse((await getConfigValue(db, "exp_live_state", "null")) || "null");
      if (live?.positions?.length) {
        positions = live.positions; direction = live.direction ?? null;
        floor = live.floor ?? -50; addLevel = live.addLevel ?? 0; peak = live.peak ?? 0;
        hedge = live.hedge ?? null;
        lastAddPrice = live.lastAddPrice ?? null; lastPosPeak = live.lastPosPeak ?? 0;
      }
    } catch {}
    await reloadConfig();
    if (positions.length) log(`pila restaurada al iniciar (${positions.length}/${cfg.maxStack} ${direction}, piso ${floor.toFixed(2)}${hedge?" · cobertura "+hedge.type:""})`);
    const p = await fetchExpTickPrice();
    if (p) {
      const nowSec = Math.floor(Date.now() / 1000);
      candles = [{ time: nowSec, o: p, c: p, h: p, l: p, v: 0 }];
      price = p;
    }
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
      if (tickCount % 3 === 0) await syncDerivProfits(); // ancla real más fresca para la interpolación en vivo del cliente
      // El precio se actualiza SIEMPRE (lo necesita el cierre manual aunque
      // el experimento esté pausado) — lo que si se salta cuando está
      // apagado es la lógica automática de entrada/apilado/volteo. Antes
      // esto estaba todo detrás de "if (!cfg.enabled) return", lo que
      // dejaba el botón "Cerrar"/"Cerrar todo" sin efecto mientras el
      // experimento estuviera apagado — reportado en vivo.
      const np = await fetchExpTickPrice();
      if (np && !isNaN(np)) {
        price = np;
        // Clave aparte de exp_live_state (que solo escribe cuando floor/
        // positions cambian) — el precio cambia casi en cada tick, así que
        // necesita su propio canal de solo-precio para que el cliente (en
        // modo no-dueño) pueda mostrar el MISMO precio que usa el servidor
        // para decidir, en vez de pedirle su propio feed a otra fuente.
        // Reportado en vivo: "el actual" no se movía igual que Deriv.
        setConfigValue(db, "exp_live_price", String(np)).catch(() => {});
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
