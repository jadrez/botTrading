// Raised from 3/6 — the per-symbol cap of 3 kept blocking new opens on a
// single active symbol (e.g. BTC/USDT sitting at 3/3 while other validated
// symbols had zero) well before the global cap ever mattered. At $3 stake,
// worst-case total loss across all 10 (Deriv multipliers cap loss at stake)
// is $30 — 15% of a $200 starting balance, a sane ceiling for more parallel
// opportunities without materially changing per-trade risk.
export const MAX_POSITIONS        = 10;   // per-symbol cap (counts both modes together)
// Simulado's own global cap — kept INDEPENDENT of MAX_REAL_POSITIONS below.
// Before this split, both modes shared one pool of 10: Simulado (far more
// eligible symbols — crypto/commodities/forex, and a lower confidence bar)
// filled it almost immediately, leaving real trading starved of a slot even
// when a qualifying forex signal appeared. Now each mode gets its own 10, so
// up to 20 total can be open (10 Simulado + 10 Real) — Simulado still gets
// to learn freely without crowding out Real.
export const MAX_SIM_POSITIONS    = 10;

// Real-money (Deriv) position cap — its own independent pool from
// MAX_SIM_POSITIONS above (see that constant's comment). Started at 1
// (extremely conservative,
// for the first real connection); raised to 10 once real execution was
// verified working end to end (open, close, portfolio sync, Deriv-side
// closure reconciliation all confirmed live). At $5 stake, worst case is
// 10 × $5 = $50 (Deriv's stop-out caps any single loss at its own stake).
export const MAX_REAL_POSITIONS   = 10;
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

// Simulado-only: several MIXTO pairs sit at an 80-90% walk-forward-validated
// confidence bar, which is correctly strict for real money but means paper
// trading rarely opens/rotates — too few completed round-trips for the
// pattern-learning system to have much to learn from. Knock this many points
// off the bar ONLY for a candidate that will land in Simulado (crypto/
// commodities always, or forex once the real-money cap rules out Deriv
// Real) — a real-money candidate always keeps the full validated bar
// untouched. Floored so it never gets so low it's just trading noise.
export const SIM_CONFIDENCE_DISCOUNT = 15;
export const SIM_CONFIDENCE_FLOOR    = 45;

// Real money, correlated-duplicate case: with only 8 forex pairs all
// fundamentally tracking USD strength, a hard block here (the original
// design) meant just 2 open real positions on opposite sides (e.g. AUD/USD
// BUY + USD/CHF BUY) mathematically blocked EVERY other pair in BOTH
// directions — verified live, real trading never diversified past 2 symbols.
// Changed from a block to a confidence PENALTY on request: a real candidate
// that's the same underlying bet as an already-open real position on a
// correlated symbol can still go real, just needs this many extra points of
// confidence — still discourages piling into one factor, without making
// diversification mathematically impossible.
export const CORR_DUP_CONFIDENCE_PENALTY = 12;
