export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return res.status(500).json({ error: "ALPHA_VANTAGE_KEY not set" });

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=FOREX:EUR,FOREX:USD&topics=forex,economy_macro&sort=LATEST&limit=10&apikey=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json();

    if (d.Note || d.Information) {
      // rate limit hit
      return res.status(200).json({ headlines: [], market_bias: "neutral", summary: "Límite de solicitudes alcanzado. Intenta en unos minutos." });
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

    const summary = `${headlines.length} noticias recientes. Sentimiento promedio del mercado: ${market_bias.toUpperCase()}. Fuente: Alpha Vantage News.`;

    return res.status(200).json({ headlines, market_bias, summary });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
