// Raised from 3/6 — the per-symbol cap of 3 kept blocking new opens on a
// single active symbol (e.g. BTC/USDT sitting at 3/3 while other validated
// symbols had zero) well before the global cap ever mattered. At $3 stake,
// worst-case total loss across all 10 (Deriv multipliers cap loss at stake)
// is $30 — 15% of a $200 starting balance, a sane ceiling for more parallel
// opportunities without materially changing per-trade risk.
export const MAX_POSITIONS        = 10;   // per-symbol cap
export const MAX_TOTAL_POSITIONS  = 10;   // global cap across every symbol combined —
                                            // matters once AUTO can open on more than the active symbol
// v4: raised $3 -> $5. At $5 stake × 100x (notional $500), the validated
// price-move % (0.6-0.9%) scales to a ~$3-4.50 TP — lands the per-trade
// dollar target where it was asked to land ($3+ before the trailing
// extension takes over). SL stays whatever the walk-forward validated for
// each symbol (~$1.50-2 at this stake) — NOT widened to chase a bigger
// "room to recover" on losers: loosening a validated stop to let losers run
// longer is the classic mistake (cut winners short, let losers run) and
// isn't something the backtest found actually helps. The real cap on any
// single loss is still Deriv's own stop-out (= stake, so $5 here) — see the
// note in trading-bot-v3.jsx above extendedStopLevel() for the winner side.
// v3 (superseded): raised from $0.05 — Deriv's Key Information Documents
// for Multipliers disclose a commission floor of $0.10/trade (min of 10
// cents, or up to 0.5% of notional) regardless of asset class; at $0.05
// stake the validated TP (~$0.03-0.09) was smaller than the floor alone —
// a guaranteed loss on real money even on a perfectly-timed winning trade.
export const DEFAULT_STAKE        = 5;      // USD stake per trade (Deriv multiplier contracts)
export const DEFAULT_MULTIPLIER   = 100;    // leverage multiplier
export const ANALYSIS_INTERVAL_MS = 300000;

// Dynamic stop-loss: once a trade's unrealized profit reaches this fraction
// of its TP target, the stop moves to breakeven (can't turn into a loss
// anymore); beyond that it trails the peak profit, allowing it to give back
// only this fraction before locking in and closing. Symmetric for BUY/SELL —
// posPnL() already folds direction in, so this just compares dollar PnL.
export const TRAIL_BREAKEVEN_AT = 0.5;  // 50% of TP reached → stop moves to breakeven
export const TRAIL_GIVEBACK     = 0.4;  // once trailing, allow giving back 40% of the peak
