// Module-level candle cache — keyed by symbol+interval, 60s TTL
const _candleCache = {};
const CANDLE_TTL = 60 * 1000;

// Yahoo Finance interval/range mapping
const YF_INTERVAL = { "1m":"1m", "5m":"5m", "15m":"15m", "1h":"60m", "4h":"60m" };
const YF_RANGE    = { "1m":"2d", "5m":"7d", "15m":"15d", "1h":"60d", "4h":"60d" };

async function fetchFromYahoo(from, to, wantCandles, limit, interval="1m") {
  const sym = `${from}${to}=X`;
  const yfInterval = YF_INTERVAL[interval] || "1m";
  const yfRange    = YF_RANGE[interval]    || "2d";
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${yfInterval}&range=${yfRange}`,
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingBot/1.0)" } }
  );
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d = await r.json();
  const result = d.chart?.result?.[0];
  if (!result) throw new Error("No chart data");

  const currentPrice = result.meta?.regularMarketPrice;
  if (!wantCandles) return { rate: currentPrice, source: "yahoo" };

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  let candles = timestamps
    .map((t, i) => ({
      time: t,
      o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i],
      v: q.volume?.[i] || 0,
    }))
    .filter(c => c.o != null && c.h != null && c.l != null && c.c != null);

  // For 4H: aggregate 1H candles into 4H blocks
  if (interval === "4h") {
    candles = aggregateCandles(candles, 4);
  }

  candles = candles.slice(-limit);
  return { candles, rate: currentPrice || candles.at(-1)?.c, source: "yahoo", interval };
}

function aggregateCandles(candles, n) {
  const out = [];
  for (let i = 0; i < candles.length; i += n) {
    const group = candles.slice(i, i + n);
    if (!group.length) continue;
    out.push({
      time: group[0].time,
      o: group[0].o,
      h: Math.max(...group.map(c => c.h)),
      l: Math.min(...group.map(c => c.l)),
      c: group.at(-1).c,
      v: group.reduce((s, c) => s + c.v, 0),
    });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { from = "EUR", to = "USD", candles: wantCandles = false, limit = 200, interval = "1m" } = req.body || {};
  const cacheKey = `${from}_${to}_${interval}`;

  // Serve candles from cache if fresh
  if (wantCandles) {
    const cached = _candleCache[cacheKey];
    if (cached && Date.now() - cached.ts < CANDLE_TTL) {
      return res.status(200).json({ ...cached.data, _cached: true });
    }
  }

  // Primary: Yahoo Finance — real OHLCV, no API key needed
  try {
    const data = await fetchFromYahoo(from, to, wantCandles, limit, interval);
    if (wantCandles && data.candles?.length > 5) {
      _candleCache[cacheKey] = { data, ts: Date.now() };
    }
    return res.status(200).json(data);
  } catch {}

  // Fallback: ECB (price only)
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const d = await r.json();
    if (d.result === "success" && d.rates?.[to]) {
      const resp = { rate: d.rates[to], source: "openexchangerates", updated: d.time_last_update_utc };
      if (wantCandles) return res.status(200).json({ ...resp, candles: [], _fallback: "ecb_price_only" });
      return res.status(200).json(resp);
    }
  } catch {}

  // Fallback: Alpha Vantage
  const avKey = process.env.ALPHA_VANTAGE_KEY;
  if (avKey) {
    try {
      const r2 = await fetch(
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${avKey}`
      );
      const d2 = await r2.json();
      const rate = parseFloat(d2?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (!isNaN(rate)) {
        const resp = { rate, source: "alphavantage" };
        if (wantCandles) return res.status(200).json({ ...resp, candles: [], _fallback: "av_price_only" });
        return res.status(200).json(resp);
      }
    } catch {}
  }

  return res.status(503).json({ error: "Rate unavailable" });
}
