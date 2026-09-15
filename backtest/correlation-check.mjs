#!/usr/bin/env node
// Computes REAL historical correlation between forex pairs (365d, 1h candles,
// same data source as walkforward.mjs) and compares it against the
// hardcoded +1/-1 assumptions in ASSETS[x].correlations (trading-bot-v3.jsx)
// — those were a theoretical "USD strength grouping" classification, never
// actually measured. Correlation is computed on log returns (not raw price
// levels), the standard approach, since two unrelated series can share a
// price trend without their moves actually tracking each other.
//
// Usage: node backtest/correlation-check.mjs

import { fetchYahooHistory } from "./lib/yahoo.mjs";

const SYMBOLS = {
  "EUR/USD": "EURUSD=X", "GBP/USD": "GBPUSD=X", "USD/JPY": "USDJPY=X",
  "AUD/USD": "AUDUSD=X", "NZD/USD": "NZDUSD=X", "USD/CHF": "USDCHF=X",
  "USD/CAD": "USDCAD=X", "EUR/GBP": "EURGBP=X",
};

// The hardcoded assumptions currently in trading-bot-v3.jsx's ASSETS config.
const ASSUMED = {
  "EUR/USD": {"GBP/USD":+1,"AUD/USD":+1,"NZD/USD":+1,"EUR/GBP":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1},
  "GBP/USD": {"EUR/USD":+1,"AUD/USD":+1,"NZD/USD":+1,"EUR/GBP":-1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1},
  "USD/JPY": {"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/CHF":+1,"USD/CAD":+1},
  "AUD/USD": {"EUR/USD":+1,"GBP/USD":+1,"NZD/USD":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1},
  "NZD/USD": {"EUR/USD":+1,"GBP/USD":+1,"AUD/USD":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1},
  "USD/CHF": {"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/JPY":+1,"USD/CAD":+1},
  "USD/CAD": {"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/JPY":+1,"USD/CHF":+1},
  "EUR/GBP": {"EUR/USD":+1,"GBP/USD":-1,"USD/CHF":-1},
};

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    cov += da * db; varA += da * da; varB += db * db;
  }
  return cov / Math.sqrt(varA * varB);
}

async function main() {
  console.log("Descargando 365d de velas 1h para 8 pares forex...\n");
  const series = {};
  for (const [sym, ticker] of Object.entries(SYMBOLS)) {
    const candles = await fetchYahooHistory(ticker, { days: 365, interval: "1h" });
    series[sym] = new Map(candles.map(c => [c.time, c.c]));
    console.log(`${sym}: ${candles.length} velas`);
  }

  // Keep only timestamps present in ALL 8 series, so every pair is compared
  // on exactly the same set of moments.
  const symbols = Object.keys(SYMBOLS);
  const commonTimes = [...series[symbols[0]].keys()]
    .filter(t => symbols.every(s => series[s].has(t)))
    .sort((a, b) => a - b);
  console.log(`\nMomentos en común entre los 8 pares: ${commonTimes.length}\n`);

  // Log returns per symbol over the common timeline.
  const returns = {};
  for (const sym of symbols) {
    const closes = commonTimes.map(t => series[sym].get(t));
    const r = [];
    for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
    returns[sym] = r;
  }

  console.log("═".repeat(100));
  console.log("PAR A       PAR B       CORRELACIÓN REAL   SUPUESTO FIJO   ¿COINCIDE EN SIGNO?");
  console.log("─".repeat(100));
  const rows = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i], b = symbols[j];
      const corr = pearson(returns[a], returns[b]);
      const assumed = ASSUMED[a]?.[b] ?? ASSUMED[b]?.[a] ?? null;
      const matches = assumed == null ? "n/a (sin supuesto)" : (Math.sign(corr) === Math.sign(assumed) ? "✓ sí" : "✗ NO");
      rows.push({ a, b, corr, assumed, matches });
      console.log(
        `${a.padEnd(11)} ${b.padEnd(11)} ${corr.toFixed(3).padStart(8)}          ${String(assumed ?? "—").padStart(6)}          ${matches}`
      );
    }
  }
  console.log("═".repeat(100));

  const withAssumption = rows.filter(r => r.assumed != null);
  const mismatches = withAssumption.filter(r => r.matches === "✗ NO");
  const weak = withAssumption.filter(r => r.matches === "✓ sí" && Math.abs(r.corr) < 0.3);
  console.log(`\nResumen: ${withAssumption.length} pares con supuesto fijo.`);
  console.log(`  Coinciden en signo: ${withAssumption.length - mismatches.length}/${withAssumption.length}`);
  console.log(`  Signo correcto pero DÉBIL (|r|<0.3, poco confiable para bloquear una apuesta real): ${weak.length}`);
  if (mismatches.length) {
    console.log(`  ⚠️ NO coinciden en signo:`);
    mismatches.forEach(r => console.log(`     ${r.a} vs ${r.b}: real=${r.corr.toFixed(3)}, supuesto=${r.assumed}`));
  }
  if (weak.length) {
    console.log(`  ⚠️ Correlación real débil (dirección correcta pero poco fuerte):`);
    weak.forEach(r => console.log(`     ${r.a} vs ${r.b}: real=${r.corr.toFixed(3)}, supuesto=${r.assumed}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
