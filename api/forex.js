// Module-level candle cache — keyed by symbol+interval, 60s TTL
const _candleCache = {};
const CANDLE_TTL = 60 * 1000;

// Always fetch 1-min data from Yahoo and aggregate — 1m data has far fewer gaps than native 5m/15m
async function fetchFromYahoo(from, to, wantCandles, limit, interval = "1m") {
  const sym = `${from}${to}=X`;

  // For 1H and 4H use native 60m data (need more history than 1m allows)
  const useNative60m = interval === "1h" || interval === "4h";
  const yfInterval = useNative60m ? "60m" : "1m";
  const yfRange    = useNative60m ? "60d" : "5d"; // 5d of 1m covers ~7200 candles (enough for any TF)

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

  // Aggregate 1m → 5m / 15m / 4h as needed
  const aggMap = { "5m": 5, "15m": 15, "4h": 4 };
  if (aggMap[interval]) {
    candles = aggregateCandles(candles, aggMap[interval]);
  }

  candles = candles.slice(-limit);
  return { candles, rate: currentPrice || candles.at(-1)?.c, source: "yahoo", interval };
}

function aggregateCandles(candles, n) {
  const out = [];
  for (let i = 0; i < candles.length; i += n) {
    const group = candles.slice(i, i + n);
    if (group.length < Math.ceil(n / 2)) continue; // skip incomplete blocks at boundaries
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

  // Primary: Yahoo Finance — fetch 1m and aggregate for better gap coverage
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
