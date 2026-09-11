// Deterministic stand-in for the rule layer in api/analyze.js.
//
// IMPORTANT — what this is and isn't:
// The live app's final decision comes from an LLM call (Groq/DeepSeek) that
// reads these same indicators plus news/correlation and free-text-reasons
// its way to a signal. Backtesting the LLM itself bar-by-bar over a year of
// history is impractical (cost, latency, non-determinism, rate limits).
// This module instead reproduces the DETERMINISTIC part of analyze.js that
// actually gates every trade regardless of what the LLM says:
//   - dominant-trend confluence voting (EMA cross, RSI zone, MACD, 5-candle
//     short trend)
//   - "never trade against the dominant trend" hard rule
//   - "lateral trend -> HOLD" hard rule
//   - minimum-confirmation-count rule
//   - support/resistance + candle-pattern priority rule
// Confidence is a transparent point score instead of an LLM guess, on the
// same 0-100 scale and same 65 / 75-after-losses thresholds the app uses.
// Treat results as a lower bound on the app's real behavior: the LLM can
// still veto a trade this engine would take (e.g. bad news), but it cannot
// override the hard rules encoded here.

export function decide(ctx, params = {}) {
  const {
    price, rsi, macdHist, ema9, ema21, ema200, bb,
    shortTrendPct, patterns, srLevels, consecutiveLosses = 0,
  } = ctx;
  const {
    requireAgree = 2,       // app's rule 4: min confirming signals (2-4)
    minConfBase = 65,       // app's rule 8: 65% normal
    minConfAfterLosses = 75, // app's rule 8: 75% after >=2 consecutive losses
  } = params;

  const emaDir = ema9 > ema21 ? "BULLISH" : "BEARISH";
  const rsiDir = rsi < 40 ? "BEARISH" : rsi > 60 ? "BULLISH" : "NEUTRAL";
  const macdDir = macdHist > 0 ? "BULLISH" : "BEARISH";
  const stDir = shortTrendPct > 0.05 ? "BULLISH" : shortTrendPct < -0.05 ? "BEARISH" : "NEUTRAL";

  const signals = [emaDir, rsiDir, macdDir, stDir];
  const bullCount = signals.filter(s => s === "BULLISH").length;
  const bearCount = signals.filter(s => s === "BEARISH").length;

  const dominant =
    bearCount >= 3 ? "BEARISH_STRONG" :
    bearCount === 2 ? "BEARISH" :
    bullCount >= 3 ? "BULLISH_STRONG" :
    bullCount === 2 ? "BULLISH" : "LATERAL";

  if (dominant === "LATERAL") return { signal: "HOLD", confidence: 0, reasons: ["lateral"] };

  const direction = dominant.startsWith("BULLISH") ? "BUY" : "SELL";
  const wantDir = direction === "BUY" ? "BULLISH" : "BEARISH";

  // Rule 2: never trade against the dominant trend (redundant given the
  // vote above picks the dominant side, kept for parity/documentation).
  const agreeCount = signals.filter(s => s === wantDir).length;

  // Rule 4: require a minimum number of confirming signals.
  if (agreeCount < requireAgree) return { signal: "HOLD", confidence: 0, reasons: ["insufficient-confluence"] };

  // Rule 3: EMA200 as macro trend filter — trading with it earns a bonus,
  // against it costs a penalty instead of an outright veto (the app treats
  // it as a bias, not a hard block, outside of the strong-trend override).
  const ema200Dir = ema200 > 0 ? (price > ema200 ? "BULLISH" : "BEARISH") : null;
  const withEma200 = ema200Dir ? ema200Dir === wantDir : null;

  // Rule 5/6: pattern + S/R priority.
  const dirPatterns = patterns.filter(p => p.signal === wantDir);
  const nearSupport = srLevels.supports?.[0];
  const nearResistance = srLevels.resistances?.[0];
  const touchesSupport = nearSupport && Math.abs(price - nearSupport.price) / price < 0.0015;
  const touchesResistance = nearResistance && Math.abs(price - nearResistance.price) / price < 0.0015;
  const srPatternPriority =
    (direction === "BUY" && touchesSupport && dirPatterns.length > 0) ||
    (direction === "SELL" && touchesResistance && dirPatterns.length > 0);

  // Confidence score — transparent proxy for the LLM's 0-100 confidence.
  let confidence = 50;
  confidence += (agreeCount - 2) * 7;                    // extra agreeing signals
  confidence += bullCount === 4 || bearCount === 4 ? 8 : 0; // unanimous
  confidence += dirPatterns.length ? 8 : 0;
  confidence += withEma200 === true ? 6 : withEma200 === false ? -10 : 0;
  confidence += srPatternPriority ? 8 : 0;
  confidence = Math.max(0, Math.min(99, Math.round(confidence)));

  const minConf = consecutiveLosses >= 2 ? minConfAfterLosses : minConfBase;
  const shouldOpen = confidence >= minConf;

  return {
    signal: shouldOpen ? direction : "HOLD",
    confidence,
    dominant,
    reasons: [
      `agree=${agreeCount}/4`,
      dirPatterns.length ? `pattern:${dirPatterns.map(p => p.name).join(",")}` : null,
      srPatternPriority ? "sr-priority" : null,
      withEma200 === false ? "against-ema200" : null,
    ].filter(Boolean),
  };
}
