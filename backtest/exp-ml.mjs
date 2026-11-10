#!/usr/bin/env node
// Señales combinadas + eventos (picos de volatilidad / NFP) + modelo logístico validado fuera de muestra.
// Una posición, TP/SL fijos netos de comisión (comisión y spread de tu config x100). Datos: PAXGUSDT 1m.
// Uso: node backtest/exp-ml.mjs --days 60 [--tp 4 --sl 4]
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fetchBinanceHistory } from "./lib/binance.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = parseFloat(arg("days", "60")), symbol = arg("symbol", "PAXGUSDT");
const TP = parseFloat(arg("tp", "4")), SL = parseFloat(arg("sl", "4"));
const SPK = parseFloat(arg("spike", "3.5")), SKIPML = process.argv.includes("--skipml");
const STAKE = 15, MULT = 100, FEE = 0.18, SPREAD = 0.00005, HORIZON = 240;

const cache = path.join(os.tmpdir(), `exp-${symbol}-${days}d.json`);
let c;
if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 6 * 3600e3) c = JSON.parse(fs.readFileSync(cache, "utf8"));
else { console.log("Descargando…"); c = await fetchBinanceHistory(symbol, { days, interval: "1m" }); fs.writeFileSync(cache, JSON.stringify(c)); }
console.log(`${symbol} 1m: ${c.length} velas (${new Date(c[0].time*1000).toISOString().slice(0,10)} → ${new Date(c.at(-1).time*1000).toISOString().slice(0,10)}) · TP ${TP}/SL ${SL} · costo ≈ $${(FEE + SPREAD*STAKE*MULT).toFixed(2)}/trade\n`);

// ── indicadores ──
const n = c.length, close = c.map(x => x.c);
const ema = (v, p) => { const k = 2 / (p + 1), o = new Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const e15 = ema(close, 15), e60 = ema(close, 60), e240 = ema(close, 240);
const macdLine = ema(close, 12).map((x, i) => x - ema(close, 26)[i] * 0); // placeholder, recalculado abajo
const e12 = ema(close, 12), e26 = ema(close, 26);
const macd = e12.map((x, i) => x - e26[i]); const sig = ema(macd, 9); const hist = macd.map((x, i) => x - sig[i]);
const rsi = new Array(n).fill(50); { let g = 0, l = 0; for (let i = 1; i < n; i++) { const d = close[i] - close[i-1]; const gg = Math.max(d,0), ll = Math.max(-d,0); if (i <= 14) { g += gg/14; l += ll/14; } else { g = (g*13 + gg)/14; l = (l*13 + ll)/14; } rsi[i] = l === 0 ? 100 : 100 - 100/(1 + g/l); } }
const atr = new Array(n).fill(0); { let s = 0; for (let i = 0; i < n; i++) { s += c[i].h - c[i].l; if (i >= 14) s -= c[i-14].h - c[i-14].l; atr[i] = s / Math.min(i+1, 14); } }
const hi20 = new Array(n).fill(0), lo20 = new Array(n).fill(0);
for (let i = 21; i < n; i++) { let h = -Infinity, l = Infinity; for (let k = i-20; k < i; k++) { h = Math.max(h, c[k].h); l = Math.min(l, c[k].l); } hi20[i] = h; lo20[i] = l; }
const col = i => c[i].c > c[i].o ? 1 : c[i].c < c[i].o ? -1 : 0;

// ── resultado neto de abrir en el cierre de la vela i, dirección d (1=BUY,-1=SELL) ──
function outcome(i, d) {
  const entry = c[i].c * (1 + d * SPREAD);
  for (let j = i + 1; j < Math.min(n, i + 1 + HORIZON); j++) {
    const k = c[j], ticks = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c];
    for (const p of ticks) {
      const pn = Math.max(d * (p - entry) / entry * STAKE * MULT - FEE, -STAKE);
      if (pn >= TP) return { pnl: pn, end: j };
      if (pn <= -SL) return { pnl: pn, end: j };
    }
  }
  const j = Math.min(n - 1, i + HORIZON);
  return { pnl: Math.max(d * (c[j].c - entry) / entry * STAKE * MULT - FEE, -STAKE), end: j };
}

// ── votos de cada señal ──
const votes = i => ({
  rsi: rsi[i] > 55 ? 1 : rsi[i] < 45 ? -1 : 0,
  macd: hist[i] > 0 ? 1 : hist[i] < 0 ? -1 : 0,
  tFast: e15[i] > e60[i] ? 1 : -1,
  tSlow: e60[i] > e240[i] ? 1 : -1,
  brk: c[i].c > hi20[i] ? 1 : c[i].c < lo20[i] ? -1 : 0,
  mom3: col(i) !== 0 && col(i) === col(i-1) && col(i) === col(i-2) ? col(i) : 0,
});
const spike = i => { let mx = 0, mn = Infinity; for (let k = i-4; k <= i; k++) { mx = Math.max(mx, c[k].h); mn = Math.min(mn, c[k].l); } return (mx - mn) > SPK * atr[i-5 > 0 ? i-5 : i]; };
const nfpWindow = t => { const d = new Date(t * 1000); if (d.getUTCDay() !== 5 || d.getUTCDate() > 7) return false; const m = d.getUTCHours() * 60 + d.getUTCMinutes(); return m >= 12*60 && m < 15*60; };

const WARM = 300;
const stat = l => ({ n: l.length, avg: l.length ? l.reduce((s, x) => s + x.pnl, 0) / l.length : 0, tot: l.reduce((s, x) => s + x.pnl, 0), wr: l.length ? l.filter(x => x.pnl > 0).length / l.length : 0 });
const fmt = (name, s) => `${name.padEnd(40)} ${String(s.n).padStart(5)}t  ${(s.wr*100).toFixed(0).padStart(3)}%  ${s.avg.toFixed(3).padStart(7)}$/t  ${s.tot.toFixed(0).padStart(6)}$`;
const thirds = l => { const t0 = c[WARM].time, t1 = c.at(-1).time, w = (t1 - t0) / 3; return [0,1,2].map(q => stat(l.filter(x => x.t >= t0 + q*w && x.t < t0 + (q+1)*w)).avg.toFixed(2)).join(" | "); };

// ═══ 1) SEÑALES COMBINADAS (secuencial, una posición a la vez) ═══
function runRule(pred) {
  const out = []; let i = WARM;
  while (i < n - HORIZON - 2) {
    const v = votes(i); const d = pred(v, i);
    if (!d) { i++; continue; }
    const r = outcome(i, d); out.push({ pnl: r.pnl, t: c[i].time, i, d, spike: spike(i), nfp: nfpWindow(c[i].time) });
    i = r.end + 1;
  }
  return out;
}
const countAgree = (v, d) => Object.values(v).filter(x => x === d).length, countOpp = (v, d) => Object.values(v).filter(x => x === -d).length;
console.log("═══ 1) SEÑALES COMBINADAS — $/trade total | por tercios del periodo ═══");
console.log("(votan: RSI>55/<45, MACD, tendencia 15m/1h, tendencia 1h/4h, ruptura 20 velas, momentum 3 velas)");
const rules = { "solo momentum 3 (referencia)": v => v.mom3 };
for (const k of [2, 3, 4, 5]) rules[`≥${k} señales coinciden y ninguna contraria`] = v => { for (const d of [1, -1]) if (countAgree(v, d) >= k && countOpp(v, d) === 0) return d; return 0; };
rules["momentum + tendencia 1h/4h + MACD"] = v => (v.mom3 && v.mom3 === v.tSlow && v.mom3 === v.macd) ? v.mom3 : 0;
rules["ruptura + RSI + MACD"] = v => (v.brk && v.brk === v.rsi && v.brk === v.macd) ? v.brk : 0;
const results = {};
for (const [name, pred] of Object.entries(rules)) { const r = runRule(pred); results[name] = r; console.log(fmt(name, stat(r)), " ", thirds(r)); }

// ═══ 2) EVENTOS ═══
console.log("\n═══ 2) EVENTOS — rendimiento de las entradas cerca de picos / del NFP vs el resto ═══");
for (const name of ["solo momentum 3 (referencia)", "≥3 señales coinciden y ninguna contraria"]) {
  const r = results[name];
  console.log(name);
  console.log("  " + fmt("tras pico de volatilidad (rango 5 velas > 3.5×ATR)", stat(r.filter(x => x.spike))));
  console.log("  " + fmt("sin pico", stat(r.filter(x => !x.spike))) + "   tercios: " + thirds(r.filter(x => !x.spike)));
  console.log("  " + fmt("ventana NFP (1er viernes, 12-15h UTC)", stat(r.filter(x => x.nfp))));
}

if (SKIPML) process.exit(0);
// ═══ 3) MODELO LOGÍSTICO (60 % entrena / 20 % calibra umbral / 20 % test intacto) ═══
console.log("\n═══ 3) MODELO — regresión logística, validado en el 20 % final que nunca vio ═══");
const feat = (i, d) => {
  const px = c[i].c, a = atr[i] || 1e-9;
  return [
    d * (rsi[i] - 50) / 25, d * hist[i] / a, d * (e15[i] - e60[i]) / a, d * (e60[i] - e240[i]) / a,
    d * (c[i].c - hi20[i]) / a, d * (c[i].c - lo20[i]) / a, d * (c[i].c - c[i-3].c) / a, d * col(i), d * col(i-1),
    a / px * 1e4, Math.sin(2*Math.PI*new Date(c[i].time*1000).getUTCHours()/24), Math.cos(2*Math.PI*new Date(c[i].time*1000).getUTCHours()/24),
  ];
};
const samples = [];
for (let i = WARM; i < n - HORIZON - 2; i += 3) for (const d of [1, -1]) { const r = outcome(i, d); samples.push({ x: feat(i, d), y: r.pnl > 0 ? 1 : 0, pnl: r.pnl, t: c[i].time, d }); }
const cut1 = Math.floor(samples.length * 0.6), cut2 = Math.floor(samples.length * 0.8);
const tr = samples.slice(0, cut1), va = samples.slice(cut1, cut2), te = samples.slice(cut2);
const dim = tr[0].x.length, mu = new Array(dim).fill(0), sd = new Array(dim).fill(0);
tr.forEach(s => s.x.forEach((v, k) => mu[k] += v / tr.length)); tr.forEach(s => s.x.forEach((v, k) => sd[k] += (v - mu[k]) ** 2 / tr.length)); sd.forEach((v, k) => sd[k] = Math.sqrt(v) || 1);
const z = s => s.x.map((v, k) => (v - mu[k]) / sd[k]);
const sigm = t => 1 / (1 + Math.exp(-t));
let w = new Array(dim).fill(0), b = 0; const Xtr = tr.map(z);
for (let ep = 0; ep < 400; ep++) {
  const gw = new Array(dim).fill(0); let gb = 0;
  for (let r = 0; r < tr.length; r++) { const p = sigm(b + Xtr[r].reduce((s, v, k) => s + v * w[k], 0)) - tr[r].y; for (let k = 0; k < dim; k++) gw[k] += p * Xtr[r][k]; gb += p; }
  for (let k = 0; k < dim; k++) w[k] -= 0.3 * (gw[k] / tr.length + 0.01 * w[k]); b -= 0.3 * gb / tr.length;
}
const prob = s => sigm(b + z(s).reduce((acc, v, k) => acc + v * w[k], 0));
const pTr = tr.map(prob), pVa = va.map(prob), pTe = te.map(prob);
const base = (l) => stat(l);
console.log(`muestras: train ${tr.length} · calibración ${va.length} · test ${te.length}   (tasa de acierto base ${(base(te).wr*100).toFixed(0)}% — TP=SL, comisión incluida)`);
console.log(fmt("test: TODAS las entradas (sin modelo)", base(te)));
let best = null;
for (const q of [0.5, 0.7, 0.8, 0.9, 0.95]) {
  const thr = [...pVa].sort((a, b) => a - b)[Math.floor(pVa.length * q)];
  const sel = va.filter((_, k) => pVa[k] >= thr); const st = stat(sel);
  if (sel.length >= 80 && (!best || st.avg > best.avg)) best = { q, thr, avg: st.avg };
  console.log(`  umbral q${(q*100).toFixed(0)} (p≥${thr.toFixed(3)}):  calibración ${stat(sel).avg.toFixed(3)}$/t (${sel.length}t)  →  TEST ${stat(te.filter((_, k) => pTe[k] >= thr)).avg.toFixed(3)}$/t (${te.filter((_, k) => pTe[k] >= thr).length}t, acierto ${(stat(te.filter((_, k) => pTe[k] >= thr)).wr*100).toFixed(0)}%)`);
}
if (best) { const sel = te.filter((_, k) => pTe[k] >= best.thr); const st = stat(sel); console.log(`\nUmbral elegido en calibración (q${(best.q*100).toFixed(0)}): TEST → ${fmt("modelo", st)}`); }
console.log("\npesos del modelo (|peso| alto = más influyente):");
["rsi","macd","tendencia 15m/1h","tendencia 1h/4h","dist. máx20","dist. mín20","retorno 3v","color vela","color vela-1","volatilidad","hora sin","hora cos"].forEach((nm, k) => console.log(`  ${nm.padEnd(18)} ${w[k].toFixed(3)}`));
