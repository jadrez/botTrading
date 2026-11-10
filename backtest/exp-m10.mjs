#!/usr/bin/env node
// Réplica de la configuración MT5 del usuario: M10, 2 velas seguidas + filtro EMA10, 0.05 lotes (5 oz),
// SIN TP, sin trailing; la posición solo cierra cuando su PnL bruto cae por debajo de -(InpLastNegUSD + spread).
// Datos: PAXGUSDT 1m 60 d (proxy del oro), agregadas a M10; los cierres se evalúan con la ruta de ticks de cada 1m.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const c1 = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "exp-PAXGUSDT-60d.json"), "utf8"));
const OZ = 5, SPREAD = 0.16, NEG = 1.0;
const agg = (arr, m) => { const o = []; for (let i = 0; i + m <= arr.length; i += m) { const s = arr.slice(i, i + m); o.push({ time: s[0].time, o: s[0].o, h: Math.max(...s.map(x => x.h)), l: Math.min(...s.map(x => x.l)), c: s.at(-1).c, i0: i, i1: i + m - 1 }); } return o; };
const tf = parseInt(process.argv[2] || "10", 10), bars = parseInt(process.argv[3] || "2", 10), maP = parseInt(process.argv[4] || "10", 10);
const m = agg(c1, tf), cl = m.map(x => x.c), k = 2 / (maP + 1); const ema = []; { let e = cl[0]; for (let i = 0; i < cl.length; i++) { e = i ? cl[i] * k + e * (1 - k) : cl[0]; ema.push(e); } }
const tick = x => (x.c >= x.o ? [x.o, x.l, x.h, x.c] : [x.o, x.h, x.l, x.c]);
function run(comm) {
  const trades = []; let i = Math.max(bars, maP) + 1;
  while (i < m.length - 2) {
    // señal al abrir la barra i: las `bars` anteriores del mismo color y cierre del lado de la EMA
    let d = 0, ok = true;
    for (let q = 1; q <= bars; q++) { const x = m[i - q], dd = x.c > x.o ? 1 : x.c < x.o ? -1 : 0; if (!dd || (d && dd !== d)) { ok = false; break; } d = dd; }
    if (!ok || (d > 0 && m[i - 1].c < ema[i - 1]) || (d < 0 && m[i - 1].c > ema[i - 1])) { i++; continue; }
    const entry = m[i].o; let exit = null, j = m[i].i0;
    outer: for (; j < c1.length; j++) for (const p of tick(c1[j])) {
      const gross = OZ * (d * (p - entry) - SPREAD);
      if (gross < -(NEG + OZ * SPREAD)) { exit = gross; break outer; }
    }
    if (exit == null) { const p = c1.at(-1).c; exit = OZ * (d * (p - entry) - SPREAD); }
    trades.push({ pnl: exit - comm, t: m[i].time });
    // siguiente barra M10 posterior al cierre
    const jb = Math.min(j, c1.length - 1); i = m.findIndex(x => x.i1 >= jb) + 1; if (i <= 0) break;
  }
  return trades;
}
const t0 = c1[0].time, w3 = (c1.at(-1).time - t0) / 3;
for (const comm of [0, 0.9, 1.5]) {
  const t = run(comm), tot = t.reduce((s, x) => s + x.pnl, 0), best = Math.max(...t.map(x => x.pnl)), wins = t.filter(x => x.pnl > 0).length;
  const th = [0,1,2].map(q => t.filter(x => x.t >= t0 + q*w3 && x.t < t0 + (q+1)*w3).reduce((s, x) => s + x.pnl, 0).toFixed(0)).join(" | ");
  console.log(`comisión $${comm.toFixed(1)}/op · ${t.length} ops · ganadoras ${(wins/t.length*100).toFixed(0)}% · total ${tot.toFixed(0)}$ · mejor op ${best.toFixed(0)}$ · SIN la mejor: ${(tot-best).toFixed(0)}$ · por tercios: ${th}`);
}
