// Simulación del motor "Experimento" ACTUAL (server-exp-engine.mjs) con comisión de Deriv,
// stop out, piso positivo, SL propio por posición, canarios y filtro de apilado — más un
// bloque opcional de FILTROS DE SEÑAL (tendencia EMA / volatilidad ATR / voltear solo a favor).
//
// Dentro de cada vela se recorren 4 ticks (o,h,l,c con h/l ordenados según el color de la vela)
// para no promediar el ruido intra-minuto como hacía exp-sim.mjs. Sigue siendo una aproximación:
// el motor real evalúa cada segundo.

const RETAIN = 0.8, FLOOR_ARM_AT = 10, QUICK_REV = 0.3, CANARY_PEAK = 5, CANARY_MIN = 3;

function ema(values, period) {
  const k = 2 / (period + 1), out = new Array(values.length);
  let e = values[0];
  for (let i = 0; i < values.length; i++) { e = i === 0 ? values[0] : values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

export function prepareIndicators(candles, { emaFast = 60, emaSlow = 240, atrN = 14 } = {}) {
  const closes = candles.map(c => c.c);
  const f = ema(closes, emaFast), s = ema(closes, emaSlow);
  const atr = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const r = candles[i].h - candles[i].l;
    sum += r;
    if (i >= atrN) sum -= candles[i - atrN].h - candles[i - atrN].l;
    atr[i] = sum / Math.min(i + 1, atrN);
  }
  return { f, s, atr };
}

// p: {stake, mult, commPct, spreadPct, addStep, floorStart, maxStack, lockFloor, lockArm, posArm, posRetain,
//     trend:boolean, atrMult:number (0=off), flipWithTrendOnly:boolean, warmup}
export function simulateExp2(candles, p, ind) {
  const fee0 = p.commPct * p.stake * p.mult;
  const pnlOf = (pos, price) => {
    const dir = pos.type === "BUY" ? 1 : -1;
    const g = dir * (price - pos.entry) / pos.entry * p.stake * p.mult;
    return Math.max(g - fee0, -p.stake);
  };
  let positions = [], direction = null, floor = p.floorStart, peak = 0, realized = 0, lastAdd = null, lastPosPeak = 0;
  const trades = [];
  const warm = p.warmup ?? 300;

  const trendDir = i => (ind.f[i] > ind.s[i] ? "BUY" : ind.f[i] < ind.s[i] ? "SELL" : null);
  const reset = () => { floor = p.floorStart; peak = 0; realized = 0; };
  const open = (type, price, t, tag) => {
    // spread/slippage adverso al abrir
    const e = type === "BUY" ? price * (1 + p.spreadPct) : price * (1 - p.spreadPct);
    positions.push({ type, entry: e, t, tag, pk: -Infinity });
    lastAdd = price; lastPosPeak = 0;
  };
  const closeAll = (price, reason, t) => {
    let tot = 0;
    for (const pos of positions) { const pn = pnlOf(pos, price); tot += pn; trades.push({ pnl: pn, reason, t, ot: pos.t }); }
    positions = [];
    return tot + realized;
  };
  const flip = (price, t, i) => {
    const total = closeAll(price, "FLIP", t);
    const opp = direction === "BUY" ? "SELL" : "BUY";
    reset();
    if (total > 0) floor = p.floorStart * QUICK_REV;
    if (p.flipWithTrendOnly && trendDir(i) !== opp) { direction = null; lastAdd = null; return; }
    direction = opp; open(opp, price, t, "VOLTEO");
  };

  const evaluate = (price, t, i) => {
    // SL propio por posición
    if (p.posRetain > 0) {
      for (const pos of [...positions]) {
        const pn = pnlOf(pos, price);
        pos.pk = Math.max(pos.pk, pn);
        if (pos.pk >= p.posArm && pn <= pos.pk * p.posRetain / 100) {
          trades.push({ pnl: pn, reason: "SL POS", t, ot: pos.t });
          positions = positions.filter(x => x !== pos);
          realized += pn;
        }
      }
      if (!positions.length) { reset(); lastAdd = null; direction = null; return; }
    }
    const stackPnl = realized + positions.reduce((s, x) => s + pnlOf(x, price), 0);
    peak = Math.max(peak, stackPnl);
    if (p.tp != null) { // modo simple: 1 posición con TP/SL fijos netos de comisión
      const pn = pnlOf(positions[0], price);
      if (pn >= p.tp || pn <= -p.sl) { trades.push({ pnl: pn, reason: pn > 0 ? "TP" : "SL", t, ot: positions[0].t }); positions = []; direction = null; reset(); lastAdd = null; }
      return;
    }
    if (p.dynFloor !== false && peak >= FLOOR_ARM_AT) floor = Math.max(floor, peak * RETAIN);
    if (p.lockFloor > 0 && peak >= Math.max(p.lockArm, p.lockFloor + 0.01)) floor = Math.max(floor, p.lockFloor);

    if (p.canary !== false && positions.length >= CANARY_MIN) {
      const lp = pnlOf(positions.at(-1), price);
      lastPosPeak = Math.max(lastPosPeak, lp);
      if (lastPosPeak >= CANARY_PEAK && lp <= lastPosPeak * RETAIN) { flip(price, t, i); return; }
    }
    if (p.canaryImm !== false && positions.length >= 2 && pnlOf(positions.at(-1), price) <= p.floorStart) { flip(price, t, i); return; }
    if (stackPnl <= floor) { flip(price, t, i); return; }

    const stepPct = p.addStep / (p.stake * p.mult);
    const moved = lastAdd != null && (direction === "BUY" ? price >= lastAdd * (1 + stepPct) : price <= lastAdd * (1 - stepPct));
    if (moved && (p.gate === false || (stackPnl - fee0) > floor) && positions.length < p.maxStack) open(direction, price, t, "PIRAMIDE");
  };

  const N = p.entryN || 20;
  const entryDir = i => {
    const prev = candles[i - 1];
    const col = prev.c < prev.o ? "SELL" : prev.c > prev.o ? "BUY" : null;
    switch (p.entry || "prev") {
      case "contra": return col === "BUY" ? "SELL" : col === "SELL" ? "BUY" : null;
      case "breakout": { // cierre previo rompe máx/mín de las N velas anteriores
        let hi = -Infinity, lo = Infinity;
        for (let k = i - 1 - N; k < i - 1; k++) { hi = Math.max(hi, candles[k].h); lo = Math.min(lo, candles[k].l); }
        return prev.c > hi ? "BUY" : prev.c < lo ? "SELL" : null;
      }
      case "momentum": { // N velas seguidas del mismo color y cuerpo grande
        const n = p.entryK || 3; let d = null;
        for (let k = i - n; k < i; k++) { const c = candles[k]; const x = c.c > c.o ? "BUY" : c.c < c.o ? "SELL" : null; if (!x || (d && x !== d)) return null; d = x; }
        return d;
      }
      default: return col;
    }
  };
  for (let i = Math.max(1, warm); i < candles.length; i++) {
    const prev = candles[i - 1], c = candles[i];
    const ticks = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
    for (let k = 0; k < 4; k++) {
      const price = ticks[k];
      if (!positions.length) {
        if (k !== 0) continue; // la entrada se decide una vez por vela (al abrir)
        const dir = entryDir(i);
        if (!dir) continue;
        if (p.trend && trendDir(i - 1) !== dir) continue;
        if (p.atrMult > 0 && ind.atr[i - 1] / price < p.atrMult * p.commPct) continue;
        direction = dir; reset(); open(dir, price, c.time, "VELA");
        continue;
      }
      evaluate(price, c.time, i);
    }
  }
  // posiciones abiertas al final: se marcan a mercado
  if (positions.length) closeAll(candles.at(-1).c, "FIN", candles.at(-1).time);

  const total = trades.reduce((s, t) => s + t.pnl, 0);
  let eq = 0, pk = 0, dd = 0;
  for (const t of trades) { eq += t.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const wins = trades.filter(t => t.pnl > 0).length;
  const fees = trades.length * fee0;
  return { list: trades, trades: trades.length, total, avg: trades.length ? total / trades.length : 0, winRate: trades.length ? wins / trades.length : 0, maxDD: dd, fees };
}
