#!/usr/bin/env node
// ¿Alinear la entrada con la señal del oro (EMA9/21 + RSI sobre muestras ~cada 15-20 s, como SEÑALES DE APERTURA) ayuda?
// Reconstruye la señal con los 4 precios por minuto (o,h/l,l/h,c) ≈ muestras cada 15 s. Una posición, TP/SL netos de comisión.
// Uso: node backtest/exp-gold-signal.mjs --days 60 [--tp 4 --sl 4]
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = parseFloat(arg("days", "60")), symbol = "PAXGUSDT", TP = parseFloat(arg("tp", "4")), SL = parseFloat(arg("sl", "4"));
const c = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `exp-${symbol}-${days}d.json`), "utf8"));
const n = c.length, STAKE = 15, MULT = 100, FEE = 0.18, SPREAD = 0.00005, HORIZON = 240;

// muestras (4 por vela) y la señal tras cada vela cerrada
const tickPath = k => (k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]);
const sigAt = new Array(n).fill(null);
{
  const buf = []; const k9 = 2 / 10, k21 = 2 / 22; let e9 = null, e21 = null;
  for (let i = 0; i < n; i++) {
    for (const p of tickPath(c[i])) {
      buf.push(p); if (buf.length > 120) buf.shift();
    }
    // recalcula sobre la ventana de 120 muestras como hace el cliente
    if (buf.length >= 22) {
      let a = buf[0], b = buf[0];
      for (let j = 1; j < buf.length; j++) { a = buf[j] * k9 + a * (1 - k9); b = buf[j] * k21 + b * (1 - k21); }
      let g = 0, l = 0; for (let j = buf.length - 14; j < buf.length; j++) { const d = buf[j] - buf[j - 1]; d > 0 ? g += d : l -= d; }
      const rsi = 100 - 100 / (1 + g / (l || 0.0001));
      const signal = a > b && rsi < 70 ? "BUY" : a < b && rsi > 30 ? "SELL" : "HOLD";
      const dirB = signal === "BUY";
      const conf = signal === "HOLD" ? 0 : Math.min(88, Math.max(45, Math.round(50 + (Math.abs(a - b) / 0.01) * 0.3 + (dirB ? Math.max(0, 60 - rsi) : Math.max(0, rsi - 40)) * 0.5)));
      sigAt[i] = { signal, conf };
    }
  }
}
function outcome(i, d) {
  const entry = c[i].c * (1 + d * SPREAD);
  for (let j = i + 1; j < Math.min(n, i + 1 + HORIZON); j++) for (const p of tickPath(c[j])) {
    const pn = Math.max(d * (p - entry) / entry * STAKE * MULT - FEE, -STAKE);
    if (pn >= TP || pn <= -SL) return { pnl: pn, end: j };
  }
  const j = Math.min(n - 1, i + HORIZON);
  return { pnl: Math.max(d * (c[j].c - entry) / entry * STAKE * MULT - FEE, -STAKE), end: j };
}
const col = i => c[i].c > c[i].o ? 1 : c[i].c < c[i].o ? -1 : 0;
const entries = {
  "vela anterior": i => col(i),
  "momentum 3 velas": i => (col(i) && col(i) === col(i - 1) && col(i) === col(i - 2) ? col(i) : 0),
};
const WARM = 300, t0 = c[WARM].time, w3 = (c.at(-1).time - t0) / 3;
function run(entryFn, minConf, gate) {
  const out = []; let i = WARM;
  while (i < n - HORIZON - 2) {
    const d = entryFn(i);
    let ok = !!d;
    if (ok && gate) { const s = sigAt[i]; ok = !!s && s.signal === (d === 1 ? "BUY" : "SELL") && s.conf >= minConf; }
    if (!ok) { i++; continue; }
    const r = outcome(i, d); out.push({ pnl: r.pnl, t: c[i].time }); i = r.end + 1;
  }
  const tot = out.reduce((s, x) => s + x.pnl, 0), thirds = [0, 1, 2].map(q => { const l = out.filter(x => x.t >= t0 + q * w3 && x.t < t0 + (q + 1) * w3); return l.length ? (l.reduce((s, x) => s + x.pnl, 0) / l.length).toFixed(2) : "—"; });
  return { n: out.length, avg: out.length ? tot / out.length : 0, tot, wr: out.length ? out.filter(x => x.pnl > 0).length / out.length : 0, thirds: thirds.join(" | ") };
}
console.log(`${symbol} 1m ${days}d · TP ${TP}/SL ${SL} · costo ≈ $${(FEE + SPREAD * STAKE * MULT).toFixed(2)}/trade\nSeñal reconstruida con 4 muestras por minuto (≈15 s).\n`);
console.log("ENTRADA / FILTRO".padEnd(44), "TRADES", " WIN", " $/trade", "  TOTAL", "  por tercios");
for (const [name, fn] of Object.entries(entries)) {
  const rows = [["sin filtro", run(fn, 0, false)], ["alineada con la señal (cualquier conf.)", run(fn, 0, true)], ["alineada, conf ≥ 60", run(fn, 60, true)], ["alineada, conf ≥ 70", run(fn, 70, true)], ["alineada, conf ≥ 80", run(fn, 80, true)]];
  for (const [lbl, r] of rows) console.log(`${(name + " · " + lbl).padEnd(44)} ${String(r.n).padStart(6)} ${(r.wr * 100).toFixed(0).padStart(3)}% ${r.avg.toFixed(3).padStart(8)} ${r.tot.toFixed(0).padStart(7)}$  ${r.thirds}`);
}
// ¿cuánto del tiempo la señal dice BUY/SELL/HOLD?
const cnt = { BUY: 0, SELL: 0, HOLD: 0 }; sigAt.forEach(s => s && cnt[s.signal]++);
console.log(`\nDistribución de la señal en el periodo: BUY ${(cnt.BUY / (cnt.BUY + cnt.SELL + cnt.HOLD) * 100).toFixed(0)}% · SELL ${(cnt.SELL / (cnt.BUY + cnt.SELL + cnt.HOLD) * 100).toFixed(0)}% · HOLD ${(cnt.HOLD / (cnt.BUY + cnt.SELL + cnt.HOLD) * 100).toFixed(0)}%`);
