export const MAX_POSITIONS        = 3;
export const DEFAULT_STAKE        = 0.05;   // USD stake per trade (Deriv multiplier contracts) — small-capital start
export const DEFAULT_MULTIPLIER   = 100;    // leverage multiplier
export const ANALYSIS_INTERVAL_MS = 300000;

// Dynamic stop-loss: once a trade's unrealized profit reaches this fraction
// of its TP target, the stop moves to breakeven (can't turn into a loss
// anymore); beyond that it trails the peak profit, allowing it to give back
// only this fraction before locking in and closing. Symmetric for BUY/SELL —
// posPnL() already folds direction in, so this just compares dollar PnL.
export const TRAIL_BREAKEVEN_AT = 0.5;  // 50% of TP reached → stop moves to breakeven
export const TRAIL_GIVEBACK     = 0.4;  // once trailing, allow giving back 40% of the peak
