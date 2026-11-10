#!/usr/bin/env node
// Reglas clásicas de tendencia a largo plazo sobre velas DIARIAS de oro (PAXG/USDT como proxy).
// Posición única, larga/corta o solo larga, costo por cambio de posición. Calibra en el primer 60 %, valida en el 40 % final.
// Uso: node backtest/exp-daily.mjs --years 5
import { fetchBinanceHistory } from "./lib/binance.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const years = parseFloat(arg("years", "5")), COST = parseFloat(arg("cost", "0.0004")); // costo por cambio de posición (fracción del precio; 0.04 % ≈ spread+comisión)
const c = await fetchBinanceHistory("PAXGUSDT", { days: Math.round(years * 365), interval: "1d" });
const n = c.length, close = c.map(x => x.c);
console.log(`PAXG/USDT diario: ${n} velas (${new Date(c[0].time*1000).toISOString().slice(0,10)} → ${new Date(c.at(-1).time*1000).toISOString().slice(0,10)}) · costo por cambio ${(COST*100).toFixed(3)} %\n`);
const ema = (v, p) => { const k = 2/(p+1), o = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i]*k + e*(1-k) : v[0]; o.push(e); } return o; };
const e50 = ema(close, 50), e200 = ema(close, 200), e20 = ema(close, 20);
const sma = (p, i) => { let s = 0; for (let k = i-p+1; k <= i; k++) s += close[k]; return s/p; };
const hi = (p, i) => Math.max(...c.slice(i-p, i).map(x => x.h)), lo = (p, i) => Math.min(...c.slice(i-p, i).map(x => x.l));
// cada regla devuelve la posición deseada para el cierre del día i: 1 largo, -1 corto, 0 plano
const rules = {
  "EMA50 > EMA200 (largo/corto)": i => e50[i] > e200[i] ? 1 : -1,
  "EMA50 > EMA200 (solo largo)": i => e50[i] > e200[i] ? 1 : 0,
  "EMA20 > EMA50 (largo/corto)": i => e20[i] > e50[i] ? 1 : -1,
  "momentum 6 meses (126d)": i => close[i] > close[i-126] ? 1 : -1,
  "momentum 12 meses (252d)": i => close[i] > close[i-252] ? 1 : -1,
  "momentum 12 meses (solo largo)": i => close[i] > close[i-252] ? 1 : 0,
  "ruptura 100d (Donchian)": (i, prev) => close[i] > hi(100, i) ? 1 : close[i] < lo(100, i) ? -1 : prev,
  "ruptura 50d (Donchian)": (i, prev) => close[i] > hi(50, i) ? 1 : close[i] < lo(50, i) ? -1 : prev,
  "precio > SMA200 (largo/corto)": i => close[i] > sma(200, i) ? 1 : -1,
  "comprar y mantener (referencia)": () => 1,
};
const start = 260, split = start + Math.floor((n - start) * 0.6);
function run(rule, from, to) {
  let pos = 0, eq = 1, peak = 1, dd = 0, changes = 0; const daily = [];
  for (let i = from; i < to - 1; i++) {
    const want = rule(i, pos);
    if (want !== pos) { eq *= 1 - COST * Math.abs(want - pos); changes++; pos = want; }
    const r = pos * (close[i+1] / close[i] - 1); eq *= 1 + r; daily.push(r);
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
  }
  const yrs = (to - from) / 365, mean = daily.reduce((a,b)=>a+b,0)/daily.length, sd = Math.sqrt(daily.reduce((s,x)=>s+(x-mean)**2,0)/daily.length) || 1;
  return { ret: (eq - 1) * 100, cagr: (Math.pow(eq, 1/yrs) - 1) * 100, dd: dd * 100, changes, sharpe: mean / sd * Math.sqrt(365) };
}
const f = r => `${r.ret.toFixed(0).padStart(6)}%  ${r.cagr.toFixed(1).padStart(6)}%/año  DD ${r.dd.toFixed(0).padStart(4)}%  cambios ${String(r.changes).padStart(3)}  Sharpe ${r.sharpe.toFixed(2).padStart(5)}`;
console.log(`Calibración: ${new Date(c[start].time*1000).toISOString().slice(0,10)} → ${new Date(c[split].time*1000).toISOString().slice(0,10)}   |   Validación (no vista): → ${new Date(c.at(-1).time*1000).toISOString().slice(0,10)}\n`);
for (const [name, rule] of Object.entries(rules)) {
  console.log(name.padEnd(34));
  console.log("   calibración  " + f(run(rule, start, split)));
  console.log("   VALIDACIÓN   " + f(run(rule, split, n)));
}
