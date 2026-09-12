// Raised from 3/6 — the per-symbol cap of 3 kept blocking new opens on a
// single active symbol (e.g. BTC/USDT sitting at 3/3 while other validated
// symbols had zero) well before the global cap ever mattered. At $3 stake,
// worst-case total loss across all 10 (Deriv multipliers cap loss at stake)
// is $30 — 15% of a $200 starting balance, a sane ceiling for more parallel
// opportunities without materially changing per-trade risk.
export const MAX_POSITIONS        = 10;   // per-symbol cap
export const MAX_TOTAL_POSITIONS  = 10;   // global cap across every symbol combined —
                                            // matters once AUTO can open on more than the active symbol
// v3: raised from $0.05 — Deriv's own Key Information Documents for
// Multipliers (forex + crypto, same product/regulator likely applies to
// commodities too) disclose a commission floor of $0.10 PER TRADE (min of
// 10 cents, or up to 0.5% of notional, whichever is greater) regardless of
// asset class. At $0.05 stake × 100x, notional is only $5, so every trade's
// validated TP (~$0.03-0.09) was SMALLER than the mandatory commission floor
// alone — a guaranteed net loss on real money even on a perfectly-timed
// winning trade. At $3 stake × 100x (notional $300), the same validated
// price-move % (0.6-0.9%) scales to a ~$1.8-2.7 TP — 18-27x the $0.10 floor,
// and lands the per-trade dollar target in the $2-3 range without inventing
// a new fixed-dollar exit rule (which would need unrealistic 20-30% price
// moves to hit at a tiny stake, and so would rarely close at all).
export const DEFAULT_STAKE        = 3;      // USD stake per trade (Deriv multiplier contracts)
export const DEFAULT_MULTIPLIER   = 100;    // leverage multiplier
export const ANALYSIS_INTERVAL_MS = 300000;

// Dynamic stop-loss: once a trade's unrealized profit reaches this fraction
// of its TP target, the stop moves to breakeven (can't turn into a loss
// anymore); beyond that it trails the peak profit, allowing it to give back
// only this fraction before locking in and closing. Symmetric for BUY/SELL —
// posPnL() already folds direction in, so this just compares dollar PnL.
export const TRAIL_BREAKEVEN_AT = 0.5;  // 50% of TP reached → stop moves to breakeven
export const TRAIL_GIVEBACK     = 0.4;  // once trailing, allow giving back 40% of the peak
