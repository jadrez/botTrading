#!/usr/bin/env node
// ¿Hay sesiones/horas (UTC) donde la entrada rinde NETO de comisión, y se sostiene fuera de muestra?
// Calibra en el primer 60 % de los datos y valida en el 40 % restante. Uso: node backtest/exp-sessions.mjs --interval 15m --days 90
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = parseFloat(arg("days", "90")), interval = arg("interval", "15m"), symbol = arg("symbol", "PAXGUSDT");
const cache = path.join(os.tmpdir(), `exp-${symbol}-${interval}-${days}d.json`);
let candles;
if (arg("source", "binance") === "deriv") {
  // Datos propios grabados por el servidor (precio real de Deriv, velas de 1m). Ej: --source deriv --symbol "XAU/USD" --days 30
  const base = arg("url", "https://trading-lijuflow.fly.dev");
  candles = await (await fetch(`${base}/api/price-candles?symbol=${encodeURIComponent(symbol)}&days=${days}`)).json();
  if (!Array.isArray(candles) || candles.length < 500) { console.log(`Aún pocos datos grabados (${candles?.length ?? 0} velas). Espera unos días.`); process.exit(0); }
} else if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 6 * 3600e3) candles = JSON.parse(fs.readFileSync(cache, "utf8"));
else { candles = await fetchBinanceHistory(symbol, { days, interval }); fs.writeFileSync(cache, JSON.stringify(candles)); }
const ind = prepareIndicators(candles, { emaFast: 12, emaSlow: 48 });
const base = { stake: 65, mult: 200, commPct: 3.02 / 13000, spreadPct: 0.00005, maxStack: 1, posRetain: 0, lockFloor: 0, warmup: 100 };
const split = candles[Math.floor(candles.length * 0.6)].time;
const SESS = { "Asia 00-07": [0, 7], "Londres 07-13": [7, 13], "NuevaYork 13-21": [13, 21], "Cierre 21-24": [21, 24] };
const sessOf = t => { const h = new Date(t * 1000).getUTCHours(); return Object.keys(SESS).find(k => h >= SESS[k][0] && h < SESS[k][1]); };
const stat = l => ({ n: l.length, avg: l.length ? l.reduce((s, x) => s + x.pnl, 0) / l.length : 0, tot: l.reduce((s, x) => s + x.pnl, 0) });
console.log(`${symbol} ${interval} ${days}d · corte train/test: ${new Date(split*1000).toISOString().slice(0,10)}\n`);
const found = [];
for (const entry of ["prev", "contra", "breakout", "momentum"])
 for (const [entryN, entryK] of entry === "breakout" ? [[10,0],[20,0],[40,0]] : entry === "momentum" ? [[0,2],[0,3]] : [[0,0]])
  for (const trend of [false, true])
   for (const [tp, sl] of [[20,10],[40,20],[40,40],[60,30],[60,60]]) {
    const r = simulateExp2(candles, { ...base, entry, entryN, entryK, trend, tp, sl }, ind);
    for (const sess of Object.keys(SESS)) {
      const mine = r.list.filter(x => sessOf(x.ot) === sess);
      const tr = stat(mine.filter(x => x.ot < split)), te = stat(mine.filter(x => x.ot >= split));
      if (tr.n >= 30 && te.n >= 30 && tr.avg > 0 && te.avg > 0)
        found.push({ cfg: `${entry}${entryN ? " N"+entryN : ""}${entryK ? " K"+entryK : ""}${trend ? " +tend" : ""} TP${tp}/SL${sl}`, sess, tr, te });
    }
   }
console.log(`Combinaciones (config × sesión) con PnL neto > 0 en TRAIN y en TEST (≥30 trades c/u): ${found.length}`);
found.sort((a, b) => Math.min(b.tr.avg, b.te.avg) - Math.min(a.tr.avg, a.te.avg)).slice(0, 15)
  .forEach(f => console.log(`${f.cfg.padEnd(34)} ${f.sess.padEnd(16)} train ${f.tr.n}t ${f.tr.avg.toFixed(2)}$/t   test ${f.te.n}t ${f.te.avg.toFixed(2)}$/t  (${f.te.tot.toFixed(0)}$)`));
// referencia: promedio por sesión de todas las configuraciones (para ver si alguna sesión es mejor en general)
console.log("\nPromedio $/trade por sesión (todas las configs, test):");
const acc = {};
for (const entry of ["prev","contra","breakout","momentum"]) {
  const r = simulateExp2(candles, { ...base, entry, entryN: 20, entryK: 3, tp: 40, sl: 40 }, ind);
  for (const sess of Object.keys(SESS)) { const te = stat(r.list.filter(x => sessOf(x.ot) === sess && x.ot >= split)); (acc[sess] ??= []).push(te.avg); }
}
for (const [k, v] of Object.entries(acc)) console.log(k.padEnd(18), (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2));
