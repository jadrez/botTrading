#!/usr/bin/env node
// Daily "learn from itself" pass — complements update-strategy.mjs (weekly,
// re-validates TP/SL/tier/minConf against FRESH MARKET DATA). This one reads
// the bot's OWN closed trades (trades table — simulated + real combined) and
// nudges minConf/tp for a symbol IF its live results say the walk-forward
// baseline is running hot or cold, bounded so it can never drift far from
// that baseline. SL is never touched here — loosening a validated stop to
// "give it room" is the classic mistake (cut winners short, let losers run);
// only update-strategy.mjs's real re-validation may change SL.
//
// Every adjustment nudges off wf_tp/wf_min_conf (the walk-forward ANCHOR,
// untouched by this script), never off yesterday's already-nudged value —
// so repeated daily runs can't compound drift, and the weekly job wipes
// whatever this script did by resetting tp/min_conf = wf_tp/wf_min_conf.
//
// Usage: node backtest/retrain-live.mjs [--min-sample 30] [--dry-run]
// Requires DATABASE_URL.

import { getPool } from "./lib/db.mjs";

const MIN_SAMPLE = 30;      // below this many closed trades for a symbol, skip — not enough signal to trust
const SAMPLE_WINDOW = 100;  // most recent N closed trades considered
const CONF_STEP = 8;        // points nudged when live results are clearly good/bad
const CONF_MAX_DRIFT = 10;  // never more than this far from wf_min_conf
const CONF_FLOOR = 40, CONF_CEIL = 90;
const TP_STEP = 0.10;       // 10% nudge when TP is rarely reached
const TP_MAX_DRIFT = 0.20;  // never more than ±20% off wf_tp
const TP_HIT_RATE_LOW = 0.15; // below this fraction of closes hitting TP/TP+, the target looks unrealistic

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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minSample = parseInt(args["min-sample"] || String(MIN_SAMPLE), 10);
  const dryRun = !!args["dry-run"];

  const pool = getPool();
  if (!pool) { console.error("DATABASE_URL no configurada — abortando."); process.exit(1); }

  const { rows: strategies } = await pool.query(
    `SELECT symbol, tier, tp, sl, min_conf, wf_tp, wf_sl, wf_min_conf FROM symbol_strategy WHERE tier <> 'SIN-EDGE'`
  );

  console.log(`Reentrenando ${strategies.length} símbolos con su propio historial (muestra mín. ${minSample}, ventana ${SAMPLE_WINDOW})…`);

  let adjusted = 0, skipped = 0;
  for (const s of strategies) {
    // First run ever (wf_tp/wf_min_conf still NULL from before this feature
    // existed): treat the current tp/min_conf as the anchor, same as
    // update-strategy.mjs would after its next run.
    const wfTp = s.wf_tp != null ? parseFloat(s.wf_tp) : parseFloat(s.tp);
    const wfMinConf = s.wf_min_conf != null ? s.wf_min_conf : s.min_conf;
    if (wfTp == null || wfMinConf == null) { console.log(`  – ${s.symbol}: sin baseline tp/minConf, se omite.`); skipped++; continue; }

    const { rows: trades } = await pool.query(
      `SELECT pnl, close_reason FROM trades
       WHERE symbol = $1 AND closed_at IS NOT NULL
       ORDER BY closed_at DESC LIMIT $2`,
      [s.symbol, SAMPLE_WINDOW]
    );
    if (trades.length < minSample) { console.log(`  – ${s.symbol}: ${trades.length} trades cerrados (< ${minSample}), se omite.`); skipped++; continue; }

    const wins = trades.filter(t => parseFloat(t.pnl) > 0);
    const losses = trades.filter(t => parseFloat(t.pnl) <= 0);
    const winRate = wins.length / trades.length;
    const sumWins = wins.reduce((a, t) => a + parseFloat(t.pnl), 0);
    const sumLossesAbs = Math.abs(losses.reduce((a, t) => a + parseFloat(t.pnl), 0));
    const profitFactor = sumLossesAbs > 0 ? sumWins / sumLossesAbs : (sumWins > 0 ? 5 : 1);
    const tpHits = trades.filter(t => t.close_reason === "TP" || t.close_reason === "TP+").length;
    const tpHitRate = tpHits / trades.length;

    // ── minConf: relax if the live edge is clearly strong, tighten if weak —
    // bounded to [wfMinConf-CONF_MAX_DRIFT, wfMinConf+CONF_MAX_DRIFT].
    let targetConf = wfMinConf;
    if (winRate >= 0.60 && profitFactor >= 1.5) targetConf = wfMinConf - CONF_STEP;
    else if (winRate < 0.40 || profitFactor < 0.9) targetConf = wfMinConf + CONF_STEP;
    targetConf = clamp(targetConf, Math.max(CONF_FLOOR, wfMinConf - CONF_MAX_DRIFT), Math.min(CONF_CEIL, wfMinConf + CONF_MAX_DRIFT));

    // ── tp: only ever nudged DOWN, only when it's rarely actually reached
    // despite a non-terrible win rate (i.e. TRAIL/MANUAL closes are doing the
    // real work and the original target looks unrealistic for current
    // volatility) — bounded to wfTp*(1-TP_MAX_DRIFT).
    let targetTp = wfTp;
    if (tpHitRate < TP_HIT_RATE_LOW && winRate >= 0.35) {
      targetTp = Math.max(wfTp * (1 - TP_MAX_DRIFT), wfTp * (1 - TP_STEP));
    }

    const confChanged = targetConf !== s.min_conf;
    const tpChanged = Math.abs(targetTp - parseFloat(s.tp)) > 0.0001;
    if (!confChanged && !tpChanged) {
      console.log(`  = ${s.symbol}: sin cambios (WR ${(winRate*100).toFixed(0)}%, PF ${profitFactor.toFixed(2)}, TP-hit ${(tpHitRate*100).toFixed(0)}%, n=${trades.length})`);
      continue;
    }

    console.log(`  ✎ ${s.symbol}: WR ${(winRate*100).toFixed(0)}%, PF ${profitFactor.toFixed(2)}, TP-hit ${(tpHitRate*100).toFixed(0)}%, n=${trades.length} → minConf ${s.min_conf}→${targetConf}${tpChanged?`, tp $${parseFloat(s.tp).toFixed(2)}→$${targetTp.toFixed(2)}`:""}`);
    adjusted++;
    if (dryRun) continue;

    await pool.query(
      `UPDATE symbol_strategy SET tp = $2, min_conf = $3, live_trades_used = $4, live_adjusted_at = now(), updated_at = now() WHERE symbol = $1`,
      [s.symbol, targetTp, targetConf, trades.length]
    );
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}Listo: ${adjusted} ajustados, ${skipped} omitidos por falta de muestra, ${strategies.length - adjusted - skipped} sin cambios.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
