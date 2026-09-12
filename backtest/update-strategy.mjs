#!/usr/bin/env node
// Re-runs walk-forward validation for every known symbol and UPSERTs the
// verdict into Postgres (table `symbol_strategy`). This is what lets tiers/
// TP/SL drift with the market on a schedule (see .github/workflows) instead
// of requiring someone to eyeball walkforward.mjs output and hand-edit
// src/lib/symbolStrategy.js + api/analyze.js + redeploy every time.
//
// Usage: node backtest/update-strategy.mjs [--symbols "EUR/USD,ETH/USDT"] [--days 365] [--folds 4]
// Requires DATABASE_URL (reads from process.env, e.g. via a GH Actions secret).

import { SYMBOLS, walkforwardSymbol } from "./walkforward.mjs";
import { getPool } from "./lib/db.mjs";

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

async function upsertStrategy(pool, row) {
  await pool.query(
    `INSERT INTO symbol_strategy (symbol, tier, tp, sl, min_conf, profitable_folds, total_folds, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (symbol) DO UPDATE SET
       tier = EXCLUDED.tier, tp = EXCLUDED.tp, sl = EXCLUDED.sl, min_conf = EXCLUDED.min_conf,
       profitable_folds = EXCLUDED.profitable_folds, total_folds = EXCLUDED.total_folds,
       updated_at = now()`,
    [row.symbol, row.tier, row.tp, row.sl, row.minConf, row.profitableFolds ?? null, row.totalFolds ?? null]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days || "365", 10);
  const interval = args.interval || "1h";
  const folds = parseInt(args.folds || "4", 10);
  const symbols = args.symbols ? args.symbols.split(",").map(s => s.trim()) : Object.keys(SYMBOLS);

  const pool = getPool();
  if (!pool) { console.error("DATABASE_URL no configurada — abortando (esto es para escribir en la tabla symbol_strategy)."); process.exit(1); }

  console.log(`Re-validando ${symbols.length} símbolos (${days}d, ${folds} folds)…`);
  const rows = [];
  for (const symbol of symbols) {
    const r = await walkforwardSymbol(symbol, days, interval, folds, pool);
    if (!r || r.verdict === "sin-datos-suficientes") { console.log(`${symbol}: datos insuficientes, no se actualiza.`); continue; }

    // Use the LAST fold's chosen params — trained on the most data, closest
    // to "current" market behavior. SIN-EDGE symbols get no tp/sl/minConf,
    // matching the existing SYMBOL_STRATEGY convention (auto-trading disabled).
    const lastFold = r.foldResults[r.foldResults.length - 1];
    const row = r.verdict === "SIN-EDGE"
      ? { symbol, tier: "SIN-EDGE", tp: null, sl: null, minConf: null, profitableFolds: r.profitableFolds, totalFolds: r.totalFolds }
      : { symbol, tier: r.verdict, tp: lastFold.tpUsd, sl: lastFold.slUsd, minConf: lastFold.minConfBase, profitableFolds: r.profitableFolds, totalFolds: r.totalFolds };

    await upsertStrategy(pool, row);
    rows.push(row);
    console.log(`  ✓ ${symbol}: ${row.tier}${row.tp ? ` tp=$${row.tp} sl=$${row.sl} minConf=${row.minConf}%` : ""}`);
  }

  console.log(`\nsymbol_strategy actualizada: ${rows.length}/${symbols.length} símbolos.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
