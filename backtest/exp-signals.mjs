#!/usr/bin/env node
// ¿Los filtros de señal (tendencia / volatilidad / voltear a favor) aportan ventaja NETA de comisión?
// Datos: PAXGUSDT (token respaldado en oro) de Binance como proxy de XAU/USD.
// Uso: node backtest/exp-signals.mjs --days 14 [--symbol PAXGUSDT]
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
console.log(`${symbol}: ${candles.length} velas 1m  (${new Date(candles[0].time * 1000).toISOString().slice(0, 16)} → ${new Date(candles.at(-1).time * 1000).toISOString().slice(0, 16)})\n`);

// Config del usuario (XAU/USD, x200, stake 65, comisión $3.02 sobre nocional $13 000)
const base = { stake: 65, mult: 200, commPct: 3.02 / 13000, spreadPct: 0.00005, addStep: 4, floorStart: -7, maxStack: 5,
  lockFloor: 1, lockArm: 2, posArm: 0.5, posRetain: 80, trend: false, atrMult: 0, flipWithTrendOnly: false };

const ind = {};
const indFor = (f, s) => (ind[`${f}-${s}`] ??= prepareIndicators(candles, { emaFast: f, emaSlow: s }));

const row = (name, o, f = 60, s = 240) => {
  const r = simulateExp2(candles, { ...base, ...o }, indFor(f, s));
  console.log(`${name.padEnd(46)} ${String(r.trades).padStart(6)} ${(r.winRate * 100).toFixed(0).padStart(4)}% ${r.total.toFixed(0).padStart(8)} ${r.avg.toFixed(2).padStart(7)} ${r.maxDD.toFixed(0).padStart(8)} ${r.fees.toFixed(0).padStart(7)}`);
  return r;
};
console.log("CONFIGURACIÓN".padEnd(46), "TRADES", " WIN", "  PNL $", "  $/trd", "  MAXDD", "  COMIS");

console.log("— Control —");
row("sin comisión ni spread (cómo se veía antes)", { commPct: 0, spreadPct: 0 });
row("config actual con comisión real", {});

console.log("— Filtros solos (EMA 60/240 de 1m ≈ 1h/4h) —");
row("solo tendencia", { trend: true });
row("solo volatilidad ATR ≥ 3× comisión", { atrMult: 3 });
row("solo volatilidad ATR ≥ 6× comisión", { atrMult: 6 });
row("solo voltear a favor de la tendencia", { flipWithTrendOnly: true });

console.log("— Combinados —");
row("tendencia + voltear a favor", { trend: true, flipWithTrendOnly: true });
row("tendencia + ATR 3×", { trend: true, atrMult: 3 });
row("tendencia + ATR 3× + voltear a favor", { trend: true, atrMult: 3, flipWithTrendOnly: true });
row("tendencia (EMA 20/100) + voltear a favor", { trend: true, flipWithTrendOnly: true }, 20, 100);
row("tendencia (EMA 120/480) + voltear a favor", { trend: true, flipWithTrendOnly: true }, 120, 480);

console.log("— Parámetros más anchos con tendencia —");
for (const [a, f] of [[6, -9], [8, -12], [10, -15]])
  row(`tend+voltear · apilar ${a} piso ${f}`, { trend: true, flipWithTrendOnly: true, addStep: a, floorStart: f, lockArm: 3, posArm: 1.5 });
