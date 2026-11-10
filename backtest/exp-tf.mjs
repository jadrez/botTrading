#!/usr/bin/env node
// Entradas + salida simple y pirámide en velas de 5m/15m con muchos días. Uso: node backtest/exp-tf.mjs --interval 15m --days 90
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = parseFloat(arg("days", "90")), interval = arg("interval", "15m"), symbol = arg("symbol", "PAXGUSDT");
const cache = path.join(os.tmpdir(), `exp-${symbol}-${interval}-${days}d.json`);
let candles;
if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 6 * 3600e3) candles = JSON.parse(fs.readFileSync(cache, "utf8"));
else { candles = await fetchBinanceHistory(symbol, { days, interval }); fs.writeFileSync(cache, JSON.stringify(candles)); }
console.log(`${symbol} ${interval}: ${candles.length} velas (${new Date(candles[0].time*1000).toISOString().slice(0,10)} → ${new Date(candles.at(-1).time*1000).toISOString().slice(0,10)})\n`);
const ind = prepareIndicators(candles, { emaFast: 12, emaSlow: 48 });
const base = { stake: 65, mult: 200, commPct: 3.02 / 13000, spreadPct: 0.00005, addStep: 4, floorStart: -7, maxStack: 5, lockFloor: 1, lockArm: 2, posArm: 0.5, posRetain: 80, warmup: 100 };
const fmt = (n, r) => `${n.padEnd(46)} ${String(r.trades).padStart(6)} ${(r.winRate*100).toFixed(0).padStart(4)}% ${r.total.toFixed(0).padStart(8)} ${r.avg.toFixed(2).padStart(7)} ${r.maxDD.toFixed(0).padStart(8)}`;
console.log("CONFIGURACIÓN".padEnd(46), "TRADES", " WIN", "  PNL $", "  $/trd", "  MAXDD");
console.log(fmt("motor completo (tu config)", simulateExp2(candles, base, ind)));
console.log(fmt("motor completo, apilar 10 piso -15", simulateExp2(candles, { ...base, addStep: 10, floorStart: -15, lockArm: 4, posArm: 2 }, ind)));
console.log(fmt("motor completo, apilar 20 piso -30", simulateExp2(candles, { ...base, addStep: 20, floorStart: -30, lockArm: 8, lockFloor: 3, posArm: 5 }, ind)));
const res = [];
for (const entry of ["prev", "contra", "breakout", "momentum", "trend"])
  for (const [entryN, entryK] of entry === "breakout" ? [[10,0],[20,0],[40,0]] : entry === "momentum" ? [[0,2],[0,3]] : [[0,0]])
    for (const [tp, sl] of [[10,5],[20,10],[30,15],[40,20],[60,30],[20,20],[40,40]]) {
      const o = { ...base, maxStack: 1, posRetain: 0, lockFloor: 0, tp, sl, entry: entry === "trend" ? "prev" : entry, entryN, entryK, trend: entry === "trend" };
      res.push({ n: `${entry}${entryN ? " N"+entryN : ""}${entryK ? " K"+entryK : ""}  TP${tp}/SL${sl}`, ...simulateExp2(candles, o, ind) });
    }
res.sort((a, b) => b.avg - a.avg);
console.log("\nMejores 10 de salida simple:"); res.slice(0, 10).forEach(r => console.log(fmt(r.n, r)));
console.log(`... ${res.length} combinaciones, ${res.filter(r => r.total > 0).length} con PnL > 0`);
