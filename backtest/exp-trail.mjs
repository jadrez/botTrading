import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { simulateExp2, prepareIndicators } from "./lib/exp-sim2.mjs";
const c = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "exp-PAXGUSDT-60d.json"), "utf8"));
const ind = prepareIndicators(c, { emaFast: 60, emaSlow: 240 });
const t0 = c[300].time, w3 = (c.at(-1).time - t0) / 3;
const base = { stake: 15, mult: 100, commPct: 0.18 / 1500, spreadPct: 0.00005, maxStack: 1, posRetain: 0, lockFloor: 0, warmup: 300, entry: "momentum", entryK: 3 };
const row = (name, o) => {
  const r = simulateExp2(c, { ...base, ...o }, ind);
  const th = [0,1,2].map(q => { const l = r.list.filter(x => x.ot >= t0 + q*w3 && x.ot < t0 + (q+1)*w3); return l.length ? (l.reduce((s,x)=>s+x.pnl,0)/l.length).toFixed(2) : "—"; }).join(" | ");
  console.log(`${name.padEnd(46)} ${String(r.trades).padStart(5)}t ${(r.winRate*100).toFixed(0).padStart(3)}% ${r.avg.toFixed(3).padStart(7)}$/t ${r.total.toFixed(0).padStart(6)}$  ${th}`);
};
console.log("Momentum 3 velas · 60d · stake 15 x100 · $/trade total y por tercios");
row("TP 4 fijo / SL 4 (actual)", { tp: 4, sl: 4 });
for (const [arm, ret] of [[2,70],[3,70],[4,70],[4,80],[6,70],[6,80]]) row(`sin TP · SL 4 · trailing activa ${arm} retiene ${ret}%`, { tp: 1e9, sl: 4, trailArm: arm, trailRetain: ret });
for (const [arm, ret] of [[2,70],[3,70],[4,70]]) row(`sin TP · SL 3 · trailing activa ${arm} retiene ${ret}%`, { tp: 1e9, sl: 3, trailArm: arm, trailRetain: ret });
row("TP 8 fijo / SL 4", { tp: 8, sl: 4 });
row("TP 12 fijo / SL 4", { tp: 12, sl: 4 });
