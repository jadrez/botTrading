#!/usr/bin/env node
// 1) Ablación: apaga una pieza del motor a la vez y mide el PnL neto.
// 2) Entradas alternativas con salida simple (1 posición, TP/SL fijos netos de comisión).
// Uso: node backtest/exp-ablation.mjs --days 14
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = parseFloat(arg("days", "14")), symbol = arg("symbol", "PAXGUSDT");
const cache = path.join(os.tmpdir(), `exp-${symbol}-${days}d.json`);
let candles;
if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 6 * 3600e3) candles = JSON.parse(fs.readFileSync(cache, "utf8"));
else { candles = await fetchBinanceHistory(symbol, { days, interval: "1m" }); fs.writeFileSync(cache, JSON.stringify(candles)); }
const ind = prepareIndicators(candles);

const base = { stake: 65, mult: 200, commPct: 3.02 / 13000, spreadPct: 0.00005, addStep: 4, floorStart: -7, maxStack: 5,
  lockFloor: 1, lockArm: 2, posArm: 0.5, posRetain: 80 };
const hdr = () => console.log("CONFIGURACIÓN".padEnd(48), "TRADES", " WIN", "  PNL $", "  $/trd", "  MAXDD");
const row = (name, o) => {
  const r = simulateExp2(candles, { ...base, ...o }, ind);
  console.log(`${name.padEnd(48)} ${String(r.trades).padStart(6)} ${(r.winRate * 100).toFixed(0).padStart(4)}% ${r.total.toFixed(0).padStart(8)} ${r.avg.toFixed(2).padStart(7)} ${r.maxDD.toFixed(0).padStart(8)}`);
  return r;
};

console.log(`${symbol} ${candles.length} velas 1m · comisión $3.02 + spread 0.005 %\n`);
console.log("═══ 1) ABLACIÓN (se apaga una pieza a la vez) ═══"); hdr();
row("completo (tu configuración)", {});
row("sin SL por posición", { posRetain: 0 });
row("sin piso positivo", { lockFloor: 0 });
row("sin piso dinámico 80 % del pico", { dynFloor: false });
row("sin canario (3+ posiciones)", { canary: false });
row("sin canario inmediato", { canaryImm: false });
row("sin filtro de apilado (gate)", { gate: false });
row("sin pirámide (1 posición, maxStack 1)", { maxStack: 1 });
row("sin SL pos ni piso+ ni canarios", { posRetain: 0, lockFloor: 0, canary: false, canaryImm: false });

console.log("\n═══ 2) ENTRADAS ALTERNATIVAS · salida simple TP/SL fijos (1 posición) ═══"); hdr();
const simple = { tp: 0, sl: 0, maxStack: 1, posRetain: 0, lockFloor: 0 };
const results = [];
for (const entry of ["prev", "contra", "breakout", "momentum"]) {
  for (const entryN of entry === "breakout" ? [20, 60] : [0]) {
    for (const entryK of entry === "momentum" ? [3, 5] : [0]) {
      for (const [tp, sl] of [[3, 3], [6, 3], [3, 6], [10, 5], [15, 5], [20, 10]]) {
        const o = { ...simple, entry, entryN, entryK, tp, sl };
        const r = simulateExp2(candles, { ...base, ...o }, ind);
        results.push({ name: `${entry}${entryN ? " N" + entryN : ""}${entryK ? " K" + entryK : ""}  TP${tp}/SL${sl}`, ...r });
      }
    }
  }
}
results.sort((a, b) => b.avg - a.avg);
results.slice(0, 12).forEach(r => console.log(`${r.name.padEnd(48)} ${String(r.trades).padStart(6)} ${(r.winRate * 100).toFixed(0).padStart(4)}% ${r.total.toFixed(0).padStart(8)} ${r.avg.toFixed(2).padStart(7)} ${r.maxDD.toFixed(0).padStart(8)}`));
console.log(`... (${results.length} combinaciones; ${results.filter(r => r.total > 0).length} con PnL positivo)`);
console.log("\nPeores 3:"); results.slice(-3).forEach(r => console.log(`${r.name.padEnd(48)} ${String(r.trades).padStart(6)} ${r.total.toFixed(0).padStart(8)} ${r.avg.toFixed(2).padStart(7)}`));
