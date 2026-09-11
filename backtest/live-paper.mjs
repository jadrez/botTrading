#!/usr/bin/env node
// Live forward-test ("mock en vivo"): polls REAL current forex prices from
// Yahoo Finance (not historical data) and runs the exact same validated
// rule engine + SYMBOL_STRATEGY tiers the deployed app uses, opening and
// closing SIMULATED positions (no real money, no Deriv calls) to see
// whether it's generating gains right now, in real market conditions.
//
// Honesty check built in: a short run (minutes to a few hours) will show
// very few trades — that's expected, not a bug. Forex on 5m candles moves
// slowly; the walk-forward validation (backtest/walkforward.mjs) is what
// tells you the strategy has edge over hundreds of trades. This script
// proves the live pipeline (data → indicators → decision → TP/SL/trailing
// stop) behaves the same live as it did in the backtest — it is a
// mechanism check, not a new statistical proof.
//
// Usage: node backtest/live-paper.mjs             (runs until Ctrl+C)
//        node backtest/live-paper.mjs --once       (single poll, for testing)
//        node backtest/live-paper.mjs --minutes 60 (stop after N minutes)

import { fetchYahooHistory } from "./lib/yahoo.mjs";
import { calcRSI, calcEMA, calcMACD, calcBB, calcSR, calcShortTrend } from "./lib/indicators.mjs";
import { detectCandlePatterns } from "./lib/patterns.mjs";
import { decide } from "./lib/strategy.mjs";
import { SYMBOL_STRATEGY, scaledTpSl } from "./lib/symbolStrategy.mjs";
import { getPool } from "./lib/db.mjs";

const FOREX_SYMBOLS = {
  "EUR/USD": "EURUSD=X", "GBP/USD": "GBPUSD=X", "USD/JPY": "USDJPY=X", "AUD/USD": "AUDUSD=X",
  "NZD/USD": "NZDUSD=X", "USD/CHF": "USDCHF=X", "USD/CAD": "USDCAD=X", "EUR/GBP": "EURGBP=X",
};

const STAKE = 0.05, MULT = 100;   // matches the app's current live defaults
const STARTING_CAPITAL = 200;
const POLL_MS = 60_000;
const TRAIL_BREAKEVEN_AT = 0.5, TRAIL_GIVEBACK = 0.4;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

const state = {};
for (const sym of Object.keys(FOREX_SYMBOLS)) {
  state[sym] = { openPos: null, consecutiveLosses: 0, closedTrades: [] };
}

const pool = getPool();

async function logClose(symbol, pos, exitPrice, pnl, reason) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO trades (symbol, type, entry_price, exit_price, pnl, confidence, patterns, reasons, opened_at, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [symbol, pos.type, pos.entry, exitPrice, pnl, pos.confidence,
       JSON.stringify(pos.patternNames||[]), JSON.stringify(pos.reasons||[]), new Date(pos.openedAt)]
    );
  } catch (e) { console.error("DB log error:", e.message); }
}

function ts(){ return new Date().toLocaleTimeString("es"); }

async function pollSymbol(sym, yahooSym) {
  const s = state[sym];
  const candles = await fetchYahooHistory(yahooSym, { days: 5, interval: "5m" });
  if (candles.length < 210) { console.log(`[${ts()}] ${sym}: solo ${candles.length} velas aún, esperando historial suficiente`); return; }

  const price = candles.at(-1).c;

  // ── Manage an open position first
  if (s.openPos) {
    const dir = s.openPos.type === "BUY" ? 1 : -1;
    const pnl = dir * (price - s.openPos.entry) / s.openPos.entry * STAKE * MULT;
    const peakPnl = Math.max(s.openPos.peakPnl || 0, pnl);
    s.openPos.peakPnl = peakPnl;
    const stopLevel = peakPnl >= s.openPos.tp * TRAIL_BREAKEVEN_AT
      ? Math.max(0, peakPnl * (1 - TRAIL_GIVEBACK)) : -s.openPos.sl;

    let reason = null;
    if (pnl >= s.openPos.tp) reason = "TP";
    else if (pnl <= stopLevel) reason = stopLevel > 0 ? "TRAIL" : "SL";

    if (reason) {
      s.consecutiveLosses = pnl > 0 ? 0 : s.consecutiveLosses + 1;
      s.closedTrades.push({ ...s.openPos, exit: price, pnl, reason, closedAt: Date.now() });
      console.log(`[${ts()}] ${sym} 🔔 CERRADA ${s.openPos.type} (${reason}) @ ${price.toFixed(5)} → ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`);
      await logClose(sym, s.openPos, price, pnl, reason);
      s.openPos = null;
    } else {
      console.log(`[${ts()}] ${sym} … ${s.openPos.type} abierta @ ${s.openPos.entry.toFixed(5)} | flotante ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (pico $${peakPnl.toFixed(4)})`);
    }
    return;
  }

  // ── Flat: decide whether to open
  const strat = SYMBOL_STRATEGY[sym];
  if (strat?.tier === "SIN-EDGE") { console.log(`[${ts()}] ${sym}: sin edge validado — solo monitoreo (igual que en producción)`); return; }

  const closes = candles.map(c => c.c);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const ema9 = calcEMA(closes, 9), ema21 = calcEMA(closes, 21);
  const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : 0;
  const shortTrend = calcShortTrend(candles, 5);
  const patterns = detectCandlePatterns(candles);
  const sr = calcSR(candles);

  const result = decide({
    price, rsi, macdHist: macd.hist, ema9, ema21, ema200, bb: calcBB(closes),
    shortTrendPct: shortTrend.pct, patterns, srLevels: sr, consecutiveLosses: s.consecutiveLosses,
  }, {
    requireAgree: 2,
    minConfBase: strat?.minConf || 65,
    minConfAfterLosses: Math.min(90, (strat?.minConf || 65) + 10),
  });

  if (result.signal !== "HOLD") {
    const scaled = scaledTpSl(sym, STAKE, MULT) || { tp: 0.03, sl: 0.015 };
    s.openPos = {
      type: result.signal, entry: price, tp: scaled.tp, sl: scaled.sl, peakPnl: 0,
      confidence: result.confidence, openedAt: Date.now(),
      patternNames: patterns.map(p => p.name), reasons: result.reasons,
    };
    console.log(`[${ts()}] ${sym} ✅ ABRE ${result.signal} @ ${price.toFixed(5)} (conf ${result.confidence}%, TP $${scaled.tp.toFixed(4)} / SL $${scaled.sl.toFixed(4)})`);
  } else {
    console.log(`[${ts()}] ${sym} HOLD (conf ${result.confidence}%, umbral ${strat?.minConf || 65}%)`);
  }
}

function printSummary() {
  let totalTrades = 0, wins = 0, totalPnl = 0;
  const lines = [];
  for (const [sym, s] of Object.entries(state)) {
    if (s.closedTrades.length === 0) continue;
    const w = s.closedTrades.filter(t => t.pnl > 0).length;
    const pnl = s.closedTrades.reduce((a, t) => a + t.pnl, 0);
    totalTrades += s.closedTrades.length; wins += w; totalPnl += pnl;
    lines.push(`  ${sym}: ${s.closedTrades.length}t, ${w}W, ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`);
  }
  console.log(`\n═══ RESUMEN MOCK EN VIVO (${ts()}) ═══`);
  if (totalTrades === 0) {
    console.log("  Sin operaciones cerradas todavía — normal en una ventana corta. Sigue corriendo…");
  } else {
    const wr = Math.round((wins / totalTrades) * 1000) / 10;
    const pctReturn = (totalPnl / STARTING_CAPITAL) * 100;
    console.log(`  Trades cerrados: ${totalTrades} | Win rate: ${wr}% | P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(4)} (${pctReturn >= 0 ? "+" : ""}${pctReturn.toFixed(3)}% sobre $${STARTING_CAPITAL})`);
    lines.forEach(l => console.log(l));
  }
  console.log("═".repeat(40) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stopAt = args.minutes ? Date.now() + parseFloat(args.minutes) * 60_000 : null;

  console.log(`Mock en vivo iniciado — ${Object.keys(FOREX_SYMBOLS).length} pares forex, stake $${STAKE} × ${MULT}x, capital de referencia $${STARTING_CAPITAL}.`);
  console.log(`Símbolos: ${Object.keys(FOREX_SYMBOLS).join(", ")}`);
  console.log(`(EUR/GBP está en SIN-EDGE — se monitorea pero nunca abre, igual que en producción)\n`);

  do {
    for (const [sym, yahooSym] of Object.entries(FOREX_SYMBOLS)) {
      try { await pollSymbol(sym, yahooSym); }
      catch (e) { console.error(`[${ts()}] ${sym} error: ${e.message}`); }
    }
    printSummary();
    if (args.once) break;
    if (stopAt && Date.now() >= stopAt) { console.log("Tiempo límite alcanzado — deteniendo."); break; }
    await new Promise(r => setTimeout(r, POLL_MS));
  } while (true);

  if (pool) await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
