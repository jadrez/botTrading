/* ─── VALIDATED STRATEGY CONFIG ─────────────────────────────────────────────
   Backed by backtest/walkforward.mjs — 365 days of 1h candles, 4 rolling
   walk-forward folds (params re-picked on train, judged on unseen test data).
   ROBUSTO   = profit factor > 1 held in ≥3/4 folds → auto-trading enabled
               with the TP/SL that generalized best.
   MIXTO     = edge inconsistent across folds → kept enabled but held to a
               much higher confidence bar (fewer, more selective trades).
   SIN-EDGE  = 0/4 folds profitable → auto-trading disabled. The symbol stays
               visible for manual analysis, it just won't self-open trades.
   Re-run `npm run backtest:wf -- --symbols "..."` periodically — markets
   drift, so this table is a snapshot, not a permanent verdict.

   Mirrored in backtest/lib/symbolStrategy.mjs (a plain Node script can't
   import a .jsx bundle) — keep both in sync when re-running the validation. */
export const SYMBOL_STRATEGY = {
  "ETH/USDT": { tier:"ROBUSTO", tp:8, sl:4, minConf:70 },
  "XAU/USD":  { tier:"ROBUSTO", tp:8, sl:4, minConf:70 },
  "USD/CAD":  { tier:"ROBUSTO", tp:6, sl:3, minConf:60 },
  "AUD/USD":  { tier:"ROBUSTO", tp:6, sl:6, minConf:70 },

  "BTC/USDT": { tier:"MIXTO",   tp:9, sl:3, minConf:80 },
  "EUR/USD":  { tier:"MIXTO",   tp:8, sl:4, minConf:80 },
  "GBP/USD":  { tier:"MIXTO",   tp:6, sl:3, minConf:80 },
  "USD/JPY":  { tier:"MIXTO",   tp:9, sl:3, minConf:80 },
  "NZD/USD":  { tier:"MIXTO",   tp:8, sl:4, minConf:80 },
  "USD/CHF":  { tier:"MIXTO",   tp:6, sl:3, minConf:80 },

  "SOL/USDT": { tier:"SIN-EDGE" },
  "EUR/GBP":  { tier:"SIN-EDGE" },
  "XAG/USD":  { tier:"SIN-EDGE" },
  "XTI/USD":  { tier:"SIN-EDGE" },
};

// The backtest (backtest/*.mjs) always ran at stake=$10, multiplier=100x —
// SYMBOL_STRATEGY's tp/sl are dollar amounts calibrated to THAT stake, which
// really encode a validated PRICE-MOVE PERCENTAGE (tp/(stake*mult)). If you
// trade a different stake (e.g. $0.05) but keep the same dollar tp/sl, the
// price-move target becomes absurd (thousands of %) and the trade can never
// realistically hit TP/SL. Scale tp/sl by the actual stake×multiplier so the
// validated price-move percentage is preserved at any position size.
export const BACKTEST_STAKE = 10, BACKTEST_MULT = 100;
export function scaledTpSl(sym, stake, multiplier){
  const strat=SYMBOL_STRATEGY[sym];
  if(!strat?.tp||!strat?.sl||!stake||!multiplier) return null;
  const factor=(stake*multiplier)/(BACKTEST_STAKE*BACKTEST_MULT);
  return{
    tp:Math.max(0.001,+(strat.tp*factor).toFixed(4)),
    sl:Math.max(0.001,+(strat.sl*factor).toFixed(4)),
  };
}
