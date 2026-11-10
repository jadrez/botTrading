import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";
const load = f => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8"));
const sets = { "1m 14d": load("exp-PAXGUSDT-14d.json"), "15m 90d": load("exp-PAXGUSDT-15m-90d.json") };
const base = { stake: 15, mult: 100, commPct: 0.18 / 1500, spreadPct: 0.00005, addStep: 0.2, floorStart: -0.45, maxStack: 4, lockFloor: 0.2, lockArm: 0.5, posArm: 0.5, posRetain: 80, warmup: 100 };
const f = (n, r) => `${n.padEnd(52)} ${String(r.trades).padStart(6)} ${(r.winRate*100).toFixed(0).padStart(4)}% ${r.total.toFixed(0).padStart(7)} ${r.avg.toFixed(3).padStart(8)}`;
for (const [name, c] of Object.entries(sets)) {
  const ind = prepareIndicators(c, name.startsWith("1m") ? { emaFast: 60, emaSlow: 240 } : { emaFast: 12, emaSlow: 48 });
  console.log(`\n=== ${name} · costo/trade ≈ $${(0.18 + 0.075).toFixed(2)} (comisión 0.18 + spread 0.075) ===`);
  console.log("CONFIG".padEnd(52), "TRADES", " WIN", "  PNL$", " $/trade");
  console.log(f("tu config actual", simulateExp2(c, base, ind)));
  console.log(f("tu config SIN comisión/spread (lo que ves en simulado viejo)", simulateExp2(c, { ...base, commPct: 0, spreadPct: 0 }, ind)));
  console.log(f("tu config con spread 2x (0.01%)", simulateExp2(c, { ...base, spreadPct: 0.0001 }, ind)));
  const res = [];
  for (const addStep of [0.5, 1, 2, 4]) for (const floorStart of [-1, -2, -4, -8]) for (const maxStack of [1, 3])
    res.push({ n: `apilar ${addStep} piso ${floorStart} max ${maxStack} arm ${(addStep).toFixed(1)}/lock ${(addStep/2).toFixed(1)}`, ...simulateExp2(c, { ...base, addStep, floorStart, maxStack, lockArm: addStep, lockFloor: addStep / 2, posArm: addStep }, ind) });
  for (const entry of ["prev", "contra", "breakout", "momentum"]) for (const [tp, sl] of [[1,1],[2,1],[2,2],[4,2],[4,4],[8,4]])
    res.push({ n: `simple ${entry} TP${tp}/SL${sl}`, ...simulateExp2(c, { ...base, entry, entryN: 20, entryK: 3, maxStack: 1, posRetain: 0, lockFloor: 0, tp, sl }, ind) });
  res.sort((a, b) => b.avg - a.avg);
  console.log("Mejores 6 de", res.length, "—", res.filter(r => r.total > 0).length, "con PnL>0:");
  res.slice(0, 6).forEach(r => console.log(f(r.n, r)));
}
