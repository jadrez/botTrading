// Ported verbatim from src/trading-bot-v3.jsx (detectCandlePatterns).

export function detectCandlePatterns(candles) {
  if (candles.length < 3) return [];
  const results = [];
  const c = candles.at(-1);
  const p = candles.at(-2);
  const p2 = candles.at(-3);

  const body = Math.abs(c.c - c.o);
  const range = c.h - c.l || 0.00001;
  const upperWick = c.h - Math.max(c.c, c.o);
  const lowerWick = Math.min(c.c, c.o) - c.l;
  const prevBody = Math.abs(p.c - p.o);

  if (body < range * 0.1 && range > 0)
    results.push({ name: "Doji", signal: "NEUTRAL", type: "REVERSAL", conf: 55 });

  if (lowerWick > body * 2 && upperWick < body * 0.5 && body > 0)
    results.push({ name: "Hammer", signal: "BULLISH", type: "REVERSAL", conf: 72 });

  if (upperWick > body * 2 && lowerWick < body * 0.5 && body > 0)
    results.push({ name: "Shooting Star", signal: "BEARISH", type: "REVERSAL", conf: 72 });

  if (p.c < p.o && c.c > c.o && c.o <= p.c && c.c >= p.o && body > prevBody * 0.9)
    results.push({ name: "Bullish Engulfing", signal: "BULLISH", type: "REVERSAL", conf: 76 });

  if (p.c > p.o && c.c < c.o && c.o >= p.c && c.c <= p.o && body > prevBody * 0.9)
    results.push({ name: "Bearish Engulfing", signal: "BEARISH", type: "REVERSAL", conf: 76 });

  if (p2.c < p2.o && Math.abs(p.c - p.o) < Math.abs(p2.c - p2.o) * 0.3 && c.c > c.o && c.c > p2.o)
    results.push({ name: "Morning Star", signal: "BULLISH", type: "REVERSAL", conf: 74 });

  if (p2.c > p2.o && Math.abs(p.c - p.o) < Math.abs(p2.c - p2.o) * 0.3 && c.c < c.o && c.c < p2.o)
    results.push({ name: "Evening Star", signal: "BEARISH", type: "REVERSAL", conf: 74 });

  return results;
}
