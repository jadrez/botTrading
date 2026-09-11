import { calcRSI, calcEMA, calcMACD, calcBB, calcSR, calcShortTrend } from "./indicators.mjs";
import { detectCandlePatterns } from "./patterns.mjs";
import { decide } from "./strategy.mjs";

const WINDOW = 1000;   // matches the app's live candle history size
const SR_EVERY = 20;   // recompute S/R every N bars (it's an O(n^2) pivot scan)
const WARMUP = 210;    // needs room for EMA200 + MACD(26) + BB(20) to stabilize

/**
 * Bar-by-bar simulation of the deterministic rule layer (see strategy.mjs)
 * over a single symbol's OHLC history. One open position at a time.
 *
 * Entry executes at the NEXT bar's open (not the decision bar's close) to
 * avoid look-ahead bias. TP/SL are checked against each bar's high/low —
 * if both would trigger on the same bar, the stop is assumed to hit first
 * (worst case), matching how you'd want to underwrite this in real trading.
 */
export function runBacktest(candles, opts = {}) {
  const {
    stake = 10, multiplier = 100, tpUsd = 6, slUsd = 3, maxHoldBars = 200,
    requireAgree = 2, minConfBase = 65, minConfAfterLosses = 75,
  } = opts;
  const strategyParams = { requireAgree, minConfBase, minConfAfterLosses };

  const closes = candles.map(c => c.c);
  const trades = [];
  let openPos = null;
  let pendingEntry = null; // signal decided on bar i, filled at open of bar i+1
  let consecutiveLosses = 0;
  let srCache = { supports: [], resistances: [] };

  for (let i = WARMUP; i < candles.length; i++) {
    const bar = candles[i];

    // 1) Fill a pending entry at this bar's open
    if (pendingEntry && !openPos) {
      const entry = bar.o;
      const dir = pendingEntry.type === "BUY" ? 1 : -1;
      const target = entry * (1 + (dir * tpUsd) / (stake * multiplier));
      const stop = entry * (1 - (dir * slUsd) / (stake * multiplier));
      openPos = {
        type: pendingEntry.type, entry, target, stop,
        entryIdx: i, entryTime: bar.time,
        confidence: pendingEntry.confidence, reasons: pendingEntry.reasons,
      };
      pendingEntry = null;
    }

    // 2) Manage the open position against this bar's range
    if (openPos) {
      const hitSL = openPos.type === "BUY" ? bar.l <= openPos.stop : bar.h >= openPos.stop;
      const hitTP = openPos.type === "BUY" ? bar.h >= openPos.target : bar.l <= openPos.target;
      let exitPrice = null, reason = null;
      if (hitSL) { exitPrice = openPos.stop; reason = "SL"; }
      else if (hitTP) { exitPrice = openPos.target; reason = "TP"; }
      else if (i - openPos.entryIdx >= maxHoldBars) { exitPrice = bar.c; reason = "TIMEOUT"; }

      if (exitPrice != null) {
        const dir = openPos.type === "BUY" ? 1 : -1;
        const pnl = dir * (exitPrice - openPos.entry) / openPos.entry * stake * multiplier;
        trades.push({ ...openPos, exitIdx: i, exitTime: bar.time, exitPrice, reason, pnl });
        consecutiveLosses = pnl > 0 ? 0 : consecutiveLosses + 1;
        openPos = null;
      }
    }

    // 3) Decide on this bar (only when flat) for entry next bar
    if (!openPos && !pendingEntry) {
      const windowStart = Math.max(0, i + 1 - WINDOW);
      const closeWindow = closes.slice(windowStart, i + 1);
      const candleWindow = candles.slice(windowStart, i + 1);

      if (i % SR_EVERY === 0) srCache = calcSR(candleWindow);

      const rsi = calcRSI(closeWindow);
      const macd = calcMACD(closeWindow);
      const bb = calcBB(closeWindow);
      const ema9 = calcEMA(closeWindow, 9);
      const ema21 = calcEMA(closeWindow, 21);
      const ema200 = closeWindow.length >= 200 ? calcEMA(closeWindow, 200) : 0;
      const shortTrend = calcShortTrend(candleWindow, 5);
      const patterns = detectCandlePatterns(candleWindow);

      const result = decide({
        price: bar.c, rsi, macdHist: macd.hist, ema9, ema21, ema200, bb,
        shortTrendPct: shortTrend.pct, patterns, srLevels: srCache, consecutiveLosses,
      }, strategyParams);

      if (result.signal !== "HOLD") {
        pendingEntry = { type: result.signal, confidence: result.confidence, reasons: result.reasons };
      }
    }
  }

  return trades;
}
