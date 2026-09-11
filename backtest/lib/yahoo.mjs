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
  const candles = timestamps
    .map((t, i) => ({
      time: t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] || 0,
    }))
    .filter(c => c.o != null && c.h != null && c.l != null && c.c != null);

  return candles;
}
