#!/usr/bin/env node
// Parameter sweep: tries TP/SL ratios and confluence thresholds against the
// same rule engine from lib/strategy.mjs, splits every combo in/out-of-sample
// the same way run.mjs does, and stores every result in Postgres (sweep_results)
// so it survives across sessions instead of living only in this terminal.
//
// Usage: node backtest/sweep.mjs --symbol EUR/USD --days 365
//        node backtest/sweep.mjs --symbols "EUR/USD,ETH/USDT" --days 365

import { fetchYahooHistory } from "./lib/yahoo.mjs";
import { fetchBinanceHistory } from "./lib/binance.mjs";
import { runBacktest } from "./lib/engine.mjs";
import { computeMetrics } from "./lib/metrics.mjs";
import { getPool } from "./lib/db.mjs";

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

// TP/SL pairs (USD, on a $10 stake × 100 multiplier — same defaults as the app)
const TP_SL_GRID = [
  [6, 3], [6, 4], [8, 4], [9, 3], [10, 4], [4, 4], [6, 6],
];
const REQUIRE_AGREE_GRID = [2, 3];
const MIN_CONF_GRID = [60, 70];
const MIN_TRADES_OOS = 15; // ignore configs with too few out-of-sample trades to trust

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

async function insertResult(pool, row) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO sweep_results
     (symbol, days, interval, tp_usd, sl_usd, require_agree, min_conf_base, sample,
      total_trades, wins, win_rate, total_pnl, profit_factor, max_drawdown_pct, sharpe_like)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [row.symbol, row.days, row.interval, row.tpUsd, row.slUsd, row.requireAgree, row.minConfBase,
     row.sample, row.m.total, row.m.wins, row.m.winRate, row.m.totalPnl, row.m.profitFactor,
     row.m.maxDrawdownPct, row.m.sharpeLike]
  );
}

async function sweepSymbol(symbol, days, interval, pool) {
  const cfg = SYMBOLS[symbol];
  if (!cfg) { console.error(`Símbolo desconocido: ${symbol}`); return; }

  console.log(`\n=== ${symbol} — descargando ${days}d (${interval})… ===`);
  const candles = cfg.kind === "binance"
    ? await fetchBinanceHistory(cfg.ticker, { days, interval })
    : await fetchYahooHistory(cfg.ticker, { days, interval });
  if (candles.length < 300) { console.error(`Muy pocas velas para ${symbol} (${candles.length}).`); return; }
  console.log(`${candles.length} velas.`);

  const splitIdx = Math.floor(candles.length * 0.7);
  const inSample = candles.slice(0, splitIdx);
  const outSample = candles.slice(Math.max(0, splitIdx - 210));

  const results = [];
  let n = 0;
  const totalCombos = TP_SL_GRID.length * REQUIRE_AGREE_GRID.length * MIN_CONF_GRID.length;

  for (const [tpUsd, slUsd] of TP_SL_GRID) {
    for (const requireAgree of REQUIRE_AGREE_GRID) {
      for (const minConfBase of MIN_CONF_GRID) {
        n++;
        const opts = {
          stake: 10, multiplier: 100, tpUsd, slUsd,
          requireAgree, minConfBase, minConfAfterLosses: Math.min(90, minConfBase + 10),
        };
        const inTrades = runBacktest(inSample, opts);
        const outTrades = runBacktest(outSample, opts);
        const inM = computeMetrics(inTrades);
        const outM = computeMetrics(outTrades);

        await insertResult(pool, { symbol, days, interval, tpUsd, slUsd, requireAgree, minConfBase, sample: "in", m: inM });
        await insertResult(pool, { symbol, days, interval, tpUsd, slUsd, requireAgree, minConfBase, sample: "out", m: outM });

        results.push({ tpUsd, slUsd, requireAgree, minConfBase, inM, outM });
        process.stdout.write(`\r  combo ${n}/${totalCombos}`);
      }
    }
  }
  console.log("");

  const ranked = results
    .filter(r => r.outM.total >= MIN_TRADES_OOS)
    .sort((a, b) => (b.outM.profitFactor ?? 0) - (a.outM.profitFactor ?? 0));

  console.log(`\n── Top 5 configs por profit factor OUT-OF-SAMPLE (mín. ${MIN_TRADES_OOS} trades) — ${symbol} ──`);
  if (ranked.length === 0) {
    console.log("  Ninguna configuración alcanzó el mínimo de operaciones out-of-sample.");
  }
  for (const r of ranked.slice(0, 5)) {
    console.log(
      `  TP=$${r.tpUsd} SL=$${r.slUsd} agree>=${r.requireAgree} conf>=${r.minConfBase}%  ` +
      `| IN: ${r.inM.total}t ${r.inM.winRate}% PF=${r.inM.profitFactor ?? "∞"}  ` +
      `| OUT: ${r.outM.total}t ${r.outM.winRate}% PF=${r.outM.profitFactor ?? "∞"} PnL=${r.outM.totalPnl >= 0 ? "+" : ""}$${r.outM.totalPnl}`
    );
  }
  return ranked[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days || "365", 10);
  const interval = args.interval || "1h";
  const symbols = args.symbols ? args.symbols.split(",") : [args.symbol || "EUR/USD"];

  const pool = getPool();
  if (!pool) console.log("(DATABASE_URL no configurada — los resultados no se guardarán, solo se imprimirán.)");
  else console.log("Guardando cada resultado en Postgres (tabla sweep_results)…");

  const best = {};
  for (const symbol of symbols) {
    best[symbol] = await sweepSymbol(symbol.trim(), days, interval, pool);
  }

  console.log("\n════ RESUMEN ════");
  for (const [symbol, r] of Object.entries(best)) {
    if (!r) { console.log(`${symbol}: sin configuración recomendable con los datos disponibles.`); continue; }
    console.log(`${symbol}: mejor config → TP=$${r.tpUsd} SL=$${r.slUsd}, agree>=${r.requireAgree}, conf>=${r.minConfBase}% → OUT-OF-SAMPLE PF=${r.outM.profitFactor ?? "∞"}, WR=${r.outM.winRate}%, PnL=${r.outM.totalPnl >= 0 ? "+" : ""}$${r.outM.totalPnl}`);
  }

  if (pool) await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
