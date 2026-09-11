// Historical candles for crypto — Binance public klines API (no key needed).
// Paginated: 1000 candles per call, walked forward by startTime until `days`
// of history is covered.

const INTERVAL_MS = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

export async function fetchBinanceHistory(symbol, { days = 365, interval = "1h" } = {}) {
  const stepMs = INTERVAL_MS[interval] || INTERVAL_MS["1h"];
  const endTime = Date.now();
  const startTime = endTime - days * 86_400_000;

  const candles = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance ${r.status} for ${symbol}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      candles.push({
        time: Math.floor(row[0] / 1000),
        o: parseFloat(row[1]), h: parseFloat(row[2]), l: parseFloat(row[3]), c: parseFloat(row[4]),
        v: parseFloat(row[5]),
      });
    }

    const lastOpen = rows.at(-1)[0];
    if (rows.length < 1000) break;
    cursor = lastOpen + stepMs;
    await new Promise(res => setTimeout(res, 150)); // be polite to the public rate limit
  }

  return candles;
}
