// Historical candles for forex/commodities — Yahoo Finance chart API.
// Yahoo allows ~730 days of 60m (1h) bars per request, which is plenty for
// a 1-year study; anything longer falls back to daily bars.

export async function fetchYahooHistory(yahooSymbol, { days = 365, interval = "1h" } = {}) {
  const yfInterval = interval === "1d" ? "1d" : interval === "5m" ? "5m" : "60m";
  const maxDays = yfInterval === "5m" ? 60 : yfInterval === "60m" ? 730 : 3650;
  const rangeDays = Math.min(days, maxDays);
  const range = `${rangeDays}d`;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yfInterval}&range=${range}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingBotBacktest/1.0)" } });
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${yahooSymbol}`);
  const d = await r.json();
  const result = d.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${yahooSymbol}`);

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  let candles = timestamps
    .map((t, i) => ({
      time: t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] || 0,
    }))
    .filter(c => c.o != null && c.h != null && c.l != null && c.c != null);

  // Same sanity filter as api/forex.js — Yahoo's commodity feeds (esp. CL=F /
  // XTI) occasionally return a one-off garbage candle (verified live: a
  // ~50x price spike on CL=F). A backtest over a year of 1h bars is exactly
  // the kind of window where one of these can slip in silently and corrupt
  // the walk-forward result for that symbol (XTI/USD came back 0/4
  // profitable folds — plausibly influenced by this, not necessarily a real
  // absence of edge). Drop anything too far from the series' own median.
  if (candles.length > 10) {
    const sortedCloses = [...candles.map(c => c.c)].sort((a, b) => a - b);
    const median = sortedCloses[Math.floor(sortedCloses.length / 2)];
    candles = candles.filter(c =>
      c.c > median * 0.5 && c.c < median * 2 &&
      c.h > median * 0.5 && c.h < median * 2 &&
      c.l > median * 0.5 && c.l < median * 2
    );
  }

  return candles;
}
