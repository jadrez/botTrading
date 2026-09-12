#!/usr/bin/env node
// Rolling walk-forward validation — the real confirmation test, not just a
// single 70/30 split. For each fold: pick the best config using ONLY the
// training window (an expanding window of everything before the fold), then
// judge it on the immediately-following block it has never seen. A config
// only earns trust if it keeps winning across several such folds, not just
// the one split that happened to look good.
//
// Usage: node backtest/walkforward.mjs --symbols "EUR/USD,ETH/USDT" --days 365 --folds 4

import { pathToFileURL } from "url";
import { fetchYahooHistory } from "./lib/yahoo.mjs";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { runBacktest } from "./lib/engine.mjs";
import { computeMetrics } from "./lib/metrics.mjs";
import { getPool } from "./lib/db.mjs";

export const SYMBOLS = {
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

const TP_SL_GRID = [[6, 3], [9, 3], [8, 4], [6, 6]];
const MIN_CONF_GRID = [60, 70];
const REQUIRE_AGREE = 2; // sweep.mjs found agree>=3 never changed the winner — fixed here
const MIN_TRAIN_TRADES = 15;
const WARMUP_CARRY = 210;

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

function bestOnTrain(trainCandles) {
  let best = null;
  for (const [tpUsd, slUsd] of TP_SL_GRID) {
    for (const minConfBase of MIN_CONF_GRID) {
      const opts = { stake: 10, multiplier: 100, tpUsd, slUsd, requireAgree: REQUIRE_AGREE, minConfBase, minConfAfterLosses: Math.min(90, minConfBase + 10) };
      const trades = runBacktest(trainCandles, opts);
      const m = computeMetrics(trades);
      if (m.total < MIN_TRAIN_TRADES) continue;
      const score = m.profitFactor ?? 0;
      if (!best || score > best.score) best = { tpUsd, slUsd, minConfBase, opts, m, score };
    }
  }
  return best;
}

async function insertFold(pool, row) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO walkforward_folds
     (symbol, days, interval, fold_idx, chosen_tp, chosen_sl, chosen_agree, chosen_conf,
      train_trades, train_pf, test_trades, test_win_rate, test_pnl, test_pf)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [row.symbol, row.days, row.interval, row.foldIdx, row.tpUsd, row.slUsd, REQUIRE_AGREE, row.minConfBase,
     row.trainM.total, row.trainM.profitFactor, row.testM.total, row.testM.winRate, row.testM.totalPnl, row.testM.profitFactor]
  );
}

export async function walkforwardSymbol(symbol, days, interval, folds, pool) {
  const cfg = SYMBOLS[symbol];
  if (!cfg) { console.error(`Símbolo desconocido: ${symbol}`); return null; }

  console.log(`\n=== ${symbol} — descargando ${days}d (${interval})… ===`);
  const candles = cfg.kind === "binance"
    ? await fetchBinanceHistory(cfg.ticker, { days, interval })
    : await fetchYahooHistory(cfg.ticker, { days, interval });
  if (candles.length < 500) { console.error(`Muy pocas velas para ${symbol} (${candles.length}).`); return null; }
  console.log(`${candles.length} velas.`);

  const blockSize = Math.floor(candles.length / (folds + 1));
  const foldResults = [];

  for (let k = 1; k <= folds; k++) {
    const trainEnd = blockSize * k;
    const testEnd = blockSize * (k + 1 <= folds + 1 ? k + 1 : folds + 1);
    const train = candles.slice(0, trainEnd);
    const test = candles.slice(Math.max(0, trainEnd - WARMUP_CARRY), testEnd);

    const chosen = bestOnTrain(train);
    if (!chosen) {
      console.log(`  Fold ${k}: sin config con suficientes trades en entrenamiento — omitido.`);
      continue;
    }
    const testTrades = runBacktest(test, chosen.opts);
    const testM = computeMetrics(testTrades);

    foldResults.push({ foldIdx: k, tpUsd: chosen.tpUsd, slUsd: chosen.slUsd, minConfBase: chosen.minConfBase, trainM: chosen.m, testM });
    await insertFold(pool, { symbol, days, interval, foldIdx: k, tpUsd: chosen.tpUsd, slUsd: chosen.slUsd, minConfBase: chosen.minConfBase, trainM: chosen.m, testM });

    console.log(
      `  Fold ${k}: elegido en train → TP=$${chosen.tpUsd} SL=$${chosen.slUsd} conf>=${chosen.minConfBase}% (train PF=${chosen.m.profitFactor ?? "∞"}, ${chosen.m.total}t)  ` +
      `→ TEST (nunca visto): ${testM.total}t WR=${testM.winRate}% PF=${testM.profitFactor ?? "∞"} PnL=${testM.totalPnl >= 0 ? "+" : ""}$${testM.totalPnl}`
    );
  }

  if (foldResults.length === 0) return { symbol, verdict: "sin-datos-suficientes" };

  const profitableFolds = foldResults.filter(f => (f.testM.profitFactor ?? 0) > 1).length;
  const totalTestPnl = Math.round(foldResults.reduce((a, f) => a + f.testM.totalPnl, 0) * 100) / 100;
  const totalTestTrades = foldResults.reduce((a, f) => a + f.testM.total, 0);
  const avgTestPF = foldResults.reduce((a, f) => a + (f.testM.profitFactor ?? 0), 0) / foldResults.length;

  const verdict = profitableFolds >= Math.ceil(foldResults.length * 0.6)
    ? "ROBUSTO" : profitableFolds > 0 ? "MIXTO" : "SIN-EDGE";

  console.log(`  → ${symbol}: ${profitableFolds}/${foldResults.length} folds con PF>1 en test | PnL test acumulado=${totalTestPnl >= 0 ? "+" : ""}$${totalTestPnl} (${totalTestTrades} trades) | veredicto: ${verdict}`);

  return { symbol, foldResults, profitableFolds, totalFolds: foldResults.length, totalTestPnl, totalTestTrades, avgTestPF: Math.round(avgTestPF * 100) / 100, verdict };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days || "365", 10);
  const interval = args.interval || "1h";
  const folds = parseInt(args.folds || "4", 10);
  const symbols = args.symbols ? args.symbols.split(",").map(s => s.trim()) : ["EUR/USD", "ETH/USDT"];

  const pool = getPool();
  console.log(pool ? "Guardando cada fold en Postgres (tabla walkforward_folds)…" : "(DATABASE_URL no configurada — solo se imprime.)");

  const summary = [];
  for (const symbol of symbols) {
    const r = await walkforwardSymbol(symbol, days, interval, folds, pool);
    if (r) summary.push(r);
  }

  console.log("\n════ VEREDICTO FINAL (walk-forward, sin mirar el futuro) ════");
  for (const r of summary) {
    if (r.verdict === "sin-datos-suficientes") { console.log(`${r.symbol}: datos insuficientes para validar.`); continue; }
    console.log(`${r.symbol.padEnd(9)} ${r.verdict.padEnd(9)} — ${r.profitableFolds}/${r.totalFolds} folds ganadores, PF medio test=${r.avgTestPF}, PnL test total=${r.totalTestPnl >= 0 ? "+" : ""}$${r.totalTestPnl} (${r.totalTestTrades} trades)`);
  }

  if (pool) await pool.end();
}

// Only auto-run the CLI when executed directly — update-strategy.mjs imports
// walkforwardSymbol()/SYMBOLS without wanting this file's own main() to fire.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
