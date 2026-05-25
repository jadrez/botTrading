const TICKER_MAP = {
  "ETH/USDT": "CRYPTO:ETH",
  "BTC/USDT": "CRYPTO:BTC",
  "SOL/USDT": "CRYPTO:SOL",
  "EUR/USD":  "FOREX:EUR,FOREX:USD",
  "GBP/USD":  "FOREX:GBP,FOREX:USD",
  "USD/JPY":  "FOREX:USD,FOREX:JPY",
  "AUD/USD":  "FOREX:AUD,FOREX:USD",
  "NZD/USD":  "FOREX:NZD,FOREX:USD",
  "USD/CHF":  "FOREX:USD,FOREX:CHF",
  "USD/CAD":  "FOREX:USD,FOREX:CAD",
  "EUR/GBP":  "FOREX:EUR,FOREX:GBP",
};

// Pairs that share news (all involve USD — same macro drivers)
// Reduces 8 USD-pair calls to 1, saving ~7 daily requests
const TICKER_GROUP = {
  "FOREX:EUR,FOREX:USD": "FOREX:EUR,FOREX:USD",
  "FOREX:GBP,FOREX:USD": "FOREX:GBP,FOREX:USD",
  "FOREX:USD,FOREX:JPY": "FOREX:USD,FOREX:JPY",
  "FOREX:AUD,FOREX:USD": "FOREX:AUD,FOREX:USD",
  "FOREX:NZD,FOREX:USD": "FOREX:NZD,FOREX:USD",
  "FOREX:USD,FOREX:CHF": "FOREX:USD,FOREX:CHF",
  "FOREX:USD,FOREX:CAD": "FOREX:USD,FOREX:CAD",
  "FOREX:EUR,FOREX:GBP": "FOREX:EUR,FOREX:GBP",
};

// Module-level cache — persists across requests on the same warm Vercel instance
// TTL: 4 hours (14 400 000 ms). With ~5 unique ticker combos and 4h TTL → ~30 req/day max
const _newsCache = {};
const NEWS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getCached(key) {
  const entry = _newsCache[key];
  if (!entry) return null;
  const age = Date.now() - entry.ts;
  if (age < NEWS_TTL_MS) return { ...entry.data, _cached: true, _age_min: Math.floor(age / 60000) };
  return null; // expired — but keep stale in memory as fallback
}

function setCached(key, data) {
  _newsCache[key] = { data, ts: Date.now() };
}

function getStaleFallback(key) {
  return _newsCache[key]?.data || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return res.status(500).json({ error: "ALPHA_VANTAGE_KEY not set" });

  const { symbol = "ETH/USDT" } = req.body || {};
  const tickers = TICKER_MAP[symbol] || "CRYPTO:ETH";
  const cacheKey = tickers;

  // ── Serve from cache if fresh
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${tickers}&sort=LATEST&limit=10&apikey=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json();

    // ── Rate limit hit — serve stale cache if available, otherwise neutral
    if (d.Note || d.Information) {
      const stale = getStaleFallback(cacheKey);
      if (stale) {
        return res.status(200).json({
          ...stale,
          _cached: true,
          _stale: true,
          _limit_warning: "Límite diario alcanzado — usando noticias guardadas.",
        });
      }
      return res.status(200).json({
        headlines: [], market_bias: "neutral",
        summary: "Límite de solicitudes alcanzado. Las noticias no afectarán el análisis hasta mañana.",
        _debug: d.Note || d.Information,
      });
    }

    const feed = d.feed || [];

    const sentimentMap = (label = "") => {
      const l = label.toLowerCase();
      if (l.includes("bullish")) return "bullish";
      if (l.includes("bearish")) return "bearish";
      return "neutral";
    };

    const impactMap = (score = 0) => {
      const abs = Math.abs(score);
      if (abs >= 0.35) return "ALTO";
      if (abs >= 0.15) return "MEDIO";
      return "BAJO";
    };

    const headlines = feed.slice(0, 6).map(item => ({
      title: item.title,
      sentiment: sentimentMap(item.overall_sentiment_label),
      impact: impactMap(item.overall_sentiment_score),
    }));

    const scores = feed.map(i => parseFloat(i.overall_sentiment_score) || 0);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const market_bias = avg > 0.1 ? "bullish" : avg < -0.1 ? "bearish" : "neutral";
    const summary = `${headlines.length} noticias recientes de ${symbol}. Sentimiento: ${market_bias.toUpperCase()}. Fuente: Alpha Vantage.`;

    const result = { headlines, market_bias, summary, _total: d.items };
    setCached(cacheKey, result);
    return res.status(200).json(result);

  } catch (e) {
    // Network error — serve stale if we have it
    const stale = getStaleFallback(cacheKey);
    if (stale) return res.status(200).json({ ...stale, _cached: true, _stale: true });
    return res.status(500).json({ error: e.message });
  }
}
