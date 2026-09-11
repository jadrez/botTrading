#!/usr/bin/env node
// Backtest CLI — validates the bot's rule engine against real historical
// candles before you ever risk it live.
//
// Usage:
//   node backtest/run.mjs --symbol EUR/USD --days 365
//   node backtest/run.mjs --symbol ETH/USDT --days 365 --tp 8 --sl 4
//   node backtest/run.mjs --list
//
// See backtest/lib/strategy.mjs for exactly what is and isn't simulated —
// this backtests the deterministic rule layer, not the live LLM call.

import { fetchYahooHistory } from "./lib/yahoo.mjs";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { runBacktest } from "./lib/engine.mjs";
import { computeMetrics } from "./lib/metrics.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const SYMBOLS = {
  "ETH/USDT": { kind: "binance", ticker: "ETHUSDT" },
  "BTC/USDT": { kind: "binance", ticker: "BTCUSDT" },
  "SOL/USDT": { kind: "binance", ticker: "SOLUSDT" },
  "EUR/USD":  { kind: "yahoo", ticker: "EURUSD=X" },
  "GBP/USD":  { kind: "yahoo", ticker: "GBPUSD=X" },
  "USD/JPY":  { kind: "yahoo", ticker: "USDJPY=X" },
  "AUD/USD":  { kind: "yahoo", ticker: "AUDUSD=X" },
  "NZD/USD":  { kind: "yahoo", ticker: "NZDUSD=X" },
  "USD/CHF":  { kind: "yahoo", ticker: "USDCHF=X" },
  "USD/CAD":  { kind: "yahoo", ticker: "USDCAD=X" },
  "EUR/GBP":  { kind: "yahoo", ticker: "EURGBP=X" },
  "XAU/USD":  { kind: "yahoo", ticker: "GC=F" },
  "XAG/USD":  { kind: "yahoo", ticker: "SI=F" },
  "XTI/USD":  { kind: "yahoo", ticker: "CL=F" },
};

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

function fmtUsd(n) { return (n >= 0 ? "+" : "") + "$" + n.toFixed(2); }

function printReport(label, trades, metrics) {
  console.log(`\n── ${label} ──`);
  if (metrics.total === 0) {
    console.log("  Sin operaciones en este periodo.");
    return;
  }
  console.log(`  Trades:          ${metrics.total}  (${metrics.wins}W / ${metrics.losses}L)`);
  console.log(`  Win rate:        ${metrics.winRate}%`);
  console.log(`  P&L total:       ${fmtUsd(metrics.totalPnl)}`);
  console.log(`  Profit factor:   ${metrics.profitFactor ?? "∞"}`);
  console.log(`  Avg win/loss:    ${fmtUsd(metrics.avgWin)} / -$${metrics.avgLoss.toFixed(2)}`);
  console.log(`  Max drawdown:    -$${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPct}%)`);
  console.log(`  Sharpe (trades): ${metrics.sharpeLike ?? "n/a"}`);
  console.log(`  BUY win rate:    ${metrics.byDirection.BUY.t ? Math.round(metrics.byDirection.BUY.w / metrics.byDirection.BUY.t * 100) : 0}% (${metrics.byDirection.BUY.t} trades)`);
  console.log(`  SELL win rate:   ${metrics.byDirection.SELL.t ? Math.round(metrics.byDirection.SELL.w / metrics.byDirection.SELL.t * 100) : 0}% (${metrics.byDirection.SELL.t} trades)`);
  console.log(`  Exits:           ${Object.entries(metrics.byExitReason).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("Símbolos disponibles:", Object.keys(SYMBOLS).join(", "));
    return;
  }

  const symbol = args.symbol || "EUR/USD";
  const cfg = SYMBOLS[symbol];
  if (!cfg) {
    console.error(`Símbolo desconocido: ${symbol}. Usa --list para ver los disponibles.`);
    process.exit(1);
  }

  const days = parseInt(args.days || "365", 10);
  const interval = args.interval || "1h";
  const stake = parseFloat(args.stake || "10");
  const multiplier = parseInt(args.mult || "100", 10);
  const tpUsd = parseFloat(args.tp || "6");
  const slUsd = parseFloat(args.sl || "3");
  const splitRatio = parseFloat(args.split || "0.7");

  console.log(`Descargando ${days}d de velas (${interval}) para ${symbol}…`);
  const candles = cfg.kind === "binance"
    ? await fetchBinanceHistory(cfg.ticker, { days, interval })
    : await fetchYahooHistory(cfg.ticker, { days, interval });

  if (candles.length < 300) {
    console.error(`Muy pocas velas descargadas (${candles.length}). Prueba con --days menor o revisa el símbolo.`);
    process.exit(1);
  }
  console.log(`${candles.length} velas obtenidas — desde ${new Date(candles[0].time * 1000).toISOString().slice(0, 10)} hasta ${new Date(candles.at(-1).time * 1000).toISOString().slice(0, 10)}.`);

  const opts = { stake, multiplier, tpUsd, slUsd };

  // Full-period run
  const allTrades = runBacktest(candles, opts);
  const allMetrics = computeMetrics(allTrades);
  printReport(`PERIODO COMPLETO — ${symbol}`, allTrades, allMetrics);

  // Walk-forward split: same fixed rules, just checking whether performance
  // holds up chronologically out-of-sample (no parameter fitting happens
  // here — that's the natural next step once these numbers look sane).
  const splitIdx = Math.floor(candles.length * splitRatio);
  const inSample = candles.slice(0, splitIdx);
  const outSample = candles.slice(Math.max(0, splitIdx - 210)); // keep warmup continuity

  const inTrades = runBacktest(inSample, opts);
  const outTrades = runBacktest(outSample, opts);
  printReport(`IN-SAMPLE (primeros ${Math.round(splitRatio * 100)}%)`, inTrades, computeMetrics(inTrades));
  printReport(`OUT-OF-SAMPLE (últimos ${Math.round((1 - splitRatio) * 100)}%)`, outTrades, computeMetrics(outTrades));

  if (args.json) {
    mkdirSync(new URL("./results", import.meta.url), { recursive: true });
    const fname = new URL(`./results/${symbol.replace("/", "")}_${Date.now()}.json`, import.meta.url);
    writeFileSync(fname, JSON.stringify({ symbol, days, interval, opts, allMetrics, trades: allTrades }, null, 2));
    console.log(`\nGuardado: ${fname.pathname.replace(/^\//, "")}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
