// Ported verbatim from src/trading-bot-v3.jsx so the backtest evaluates
// the exact same math the live app uses — framework-free, no React.

export function calcRSI(closes, p = 14) {
  if (closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  return 100 - 100 / (1 + g / (l || 0.0001));
}

export function calcEMA(arr, p) {
  const k = 2 / (p + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

export function calcMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  let e12 = closes[0], e26 = closes[0];
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let sig = 0, sigInit = false;
  for (let i = 1; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    e26 = closes[i] * k26 + e26 * (1 - k26);
    if (i >= 25) {
      const mv = e12 - e26;
      if (!sigInit) { sig = mv; sigInit = true; }
      else sig = mv * k9 + sig * (1 - k9);
    }
  }
  const macd = e12 - e26;
  return { macd, signal: sig, hist: macd - sig };
}

export function calcBB(closes, p = 20) {
  const sl = closes.slice(-p);
  const mean = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / sl.length);
  return { upper: mean + 2 * std, mid: mean, lower: mean - 2 * std };
}

export function calcShortTrend(candles, n = 5) {
  if (candles.length < n + 1) return { pct: 0, bearish: 0, bullish: 0, direction: "NEUTRAL" };
  const recent = candles.slice(-n);
  const bullish = recent.filter(c => c.c > c.o).length;
  const bearish = recent.filter(c => c.c < c.o).length;
  const pct = (recent.at(-1).c - recent[0].o) / recent[0].o * 100;
  const direction = pct > 0.05 ? "BULLISH" : pct < -0.05 ? "BEARISH" : "NEUTRAL";
  return { pct, bullish, bearish, direction };
}

export function calcSR(candles, tol = 0.004) {
  if (candles.length < 20) return { supports: [], resistances: [] };
  const recent = candles.slice(-600);
  const currentPrice = recent.at(-1).c;
  const levels = [];

  for (let i = 3; i < recent.length - 3; i++) {
    let isH = true, isL = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (recent[j].h >= recent[i].h) isH = false;
      if (recent[j].l <= recent[i].l) isL = false;
    }
    if (isH) levels.push({ price: recent[i].h, type: "resistance", idx: i });
    if (isL) levels.push({ price: recent[i].l, type: "support", idx: i });
  }

  const clusters = [];
  for (const lv of levels) {
    const existing = clusters.find(c => Math.abs(c.price - lv.price) / c.price < tol);
    if (existing) {
      existing.touches++;
      existing.price = (existing.price * existing.touches + lv.price) / (existing.touches + 1);
    } else {
      clusters.push({ price: lv.price, type: lv.type, touches: 1 });
    }
  }

  const strong = clusters.filter(c => c.touches >= 2);
  const supports = strong.filter(c => c.price < currentPrice * 0.9998)
    .sort((a, b) => b.price - a.price).slice(0, 4);
  const resistances = strong.filter(c => c.price > currentPrice * 1.0002)
    .sort((a, b) => a.price - b.price).slice(0, 4);

  return { supports, resistances, all: strong };
}
