import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";
const c = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "exp-PAXGUSDT-14d.json"), "utf8"));
const ind = prepareIndicators(c, { emaFast: 60, emaSlow: 240 });
const half = c[Math.floor(c.length / 2)].time;
const base = { stake: 15, mult: 100, commPct: 0.18 / 1500, spreadPct: 0.00005, maxStack: 1, posRetain: 0, lockFloor: 0, warmup: 300 };
const st = l => ({ n: l.length, avg: l.length ? l.reduce((s, x) => s + x.pnl, 0) / l.length : 0 });
console.log("Una posición, TP/SL fijos. $/trade en 1ª mitad | 2ª mitad | con spread 2x | comisión x2 (peor caso)");
for (const entry of ["prev", "contra", "breakout", "momentum"]) for (const [tp, sl] of [[2,2],[3,3],[4,4],[6,6],[8,8],[4,2],[2,4]]) {
  const o = { ...base, entry, entryN: 20, entryK: 3, tp, sl };
  const r = simulateExp2(c, o, ind);
  const a = st(r.list.filter(x => x.ot < half)), b = st(r.list.filter(x => x.ot >= half));
  const s2 = simulateExp2(c, { ...o, spreadPct: 0.0001 }, ind), c2 = simulateExp2(c, { ...o, commPct: 0.00024 }, ind);
  const ok = a.avg > 0 && b.avg > 0 && s2.avg > 0 ? "  ✔ robusto" : "";
  console.log(`${(entry + " TP" + tp + "/SL" + sl).padEnd(24)} ${String(r.trades).padStart(5)}t  ${a.avg.toFixed(3).padStart(7)} | ${b.avg.toFixed(3).padStart(7)} | ${s2.avg.toFixed(3).padStart(7)} | ${c2.avg.toFixed(3).padStart(7)}${ok}`);
}
