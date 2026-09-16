#!/usr/bin/env node
// Server-side reconciliation of Deriv's real portfolio into open_positions/
// trades — the client-side "Deriv portfolio sync" effect in
// trading-bot-v3.jsx does the same job, but ONLY while a browser tab has the
// app open with Deriv Real armed (derivEnabled). Verified live: 2 positions
// opened manually in DTrader were correctly visible via /api/deriv-order
// (action=portfolio) but never appeared in open_positions, because no tab
// was open+armed to run the client-side sync. This script does the exact
// same reconciliation from a scheduled job instead, so real positions are
// tracked regardless of whether anyone has the app open.
//
// Calls the deployed API over HTTP (same endpoint the browser uses) rather
// than talking to Deriv directly, so it needs no separate Deriv credentials
// — only DATABASE_URL, already a GitHub Actions secret for the other
// scheduled jobs (update-strategy.mjs, retrain-live.mjs).
//
// Usage: node backtest/sync-deriv-positions.mjs [--api-base https://...] [--dry-run]
// Requires DATABASE_URL.

import { getPool } from "./lib/db.mjs";

const DEFAULT_API_BASE = "https://bot-trading-nu.vercel.app";

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

async function callApi(apiBase, body) {
  const r = await fetch(`${apiBase}/api/deriv-order`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = args["api-base"] || DEFAULT_API_BASE;
  const dryRun = !!args["dry-run"];

  const pool = getPool();
  if (!pool) { console.error("DATABASE_URL no configurada — abortando."); process.exit(1); }

  console.log(`Sincronizando posiciones reales de Deriv (${apiBase})…`);

  const { positions: derivPositions } = await callApi(apiBase, { action: "portfolio" });
  const derivIds = new Set(derivPositions.map(p => String(p.contractId)));

  const { rows: tracked } = await pool.query(
    `SELECT client_id, symbol, type, entry_price, allocated_size, multiplier, tp, sl, deriv_contract_id, commission, opened_by, opened_at
     FROM open_positions WHERE deriv_contract_id IS NOT NULL`
  );
  const trackedIds = new Set(tracked.map(p => String(p.deriv_contract_id)));

  // ── Newly discovered — Deriv has it, we don't. Insert as MANUAL (any
  // position the bot itself opened was already recorded at open time).
  const newOnes = derivPositions.filter(p => !trackedIds.has(String(p.contractId)));
  for (const p of newOnes) {
    console.log(`  + nueva: ${p.symbol} ${p.type} contractId=${p.contractId} stake=$${p.buyPrice}`);
    if (dryRun) continue;
    await pool.query(
      `INSERT INTO open_positions (client_id, symbol, type, entry_price, allocated_size, multiplier, tp, sl, deriv_contract_id, commission, opened_by, opened_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MANUAL',$11)
       ON CONFLICT (deriv_contract_id) WHERE deriv_contract_id IS NOT NULL DO NOTHING`,
      [`deriv-${p.contractId}`, p.symbol, p.type, p.entry, p.buyPrice ?? null, p.multiplier ?? null,
       p.tp ?? null, p.sl ?? null, String(p.contractId), p.commission ?? null,
       p.openTime ? new Date(p.openTime) : new Date()]
    );
  }

  // ── Missing — we tracked it, Deriv no longer reports it open. Closed.
  const missing = tracked.filter(p => !derivIds.has(String(p.deriv_contract_id)));
  for (const pos of missing) {
    const detail = await callApi(apiBase, { action: "contract", contractId: pos.deriv_contract_id }).catch(() => null);
    if (!detail || !detail.isSold) { console.log(`  ? ${pos.symbol} contractId=${pos.deriv_contract_id}: sin liquidación aún, se deja para el próximo ciclo`); continue; }
    const pnl = detail.profit ?? 0;
    const posTp = pos.tp != null ? parseFloat(pos.tp) : detail.tp;
    const posSl = pos.sl != null ? parseFloat(pos.sl) : detail.sl;
    const reason = posTp != null && pnl >= posTp * 0.95 ? "TP" : posSl != null && pnl <= -posSl * 0.95 ? "SL" : "MANUAL";
    console.log(`  - cerrada: ${pos.symbol} contractId=${pos.deriv_contract_id} → ${reason} $${pnl.toFixed(2)}`);
    if (dryRun) continue;
    await pool.query(
      `INSERT INTO trades (symbol, type, entry_price, exit_price, pnl, close_reason, deriv_contract_id, commission, allocated_size, multiplier, opened_by, opened_at, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [pos.symbol, pos.type, pos.entry_price, detail.exitSpot ?? pos.entry_price, pnl, reason,
       pos.deriv_contract_id, pos.commission ?? detail.commission ?? null,
       pos.allocated_size, pos.multiplier, pos.opened_by || "MANUAL",
       pos.opened_at, detail.closeTime ? new Date(detail.closeTime) : new Date()]
    );
    await pool.query(`DELETE FROM open_positions WHERE client_id = $1`, [pos.client_id]);
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}Listo: ${newOnes.length} nueva(s), ${missing.length} cerrada(s) reconciliada(s), ${derivPositions.length} reales abiertas en Deriv ahora mismo.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
