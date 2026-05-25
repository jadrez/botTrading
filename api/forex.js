export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { from = "EUR", to = "USD" } = req.body || {};

  try {
    // Primary: open.er-api.com (free, no key, hourly ECB updates)
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const d = await r.json();

    if (d.result === "success" && d.rates?.[to]) {
      return res.status(200).json({
        rate: d.rates[to],
        source: "openexchangerates",
        updated: d.time_last_update_utc,
      });
    }

    // Fallback: Alpha Vantage CURRENCY_EXCHANGE_RATE
    const avKey = process.env.ALPHA_VANTAGE_KEY;
    if (avKey) {
      const r2 = await fetch(
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${avKey}`
      );
      const d2 = await r2.json();
      const rate = parseFloat(d2?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (!isNaN(rate)) {
        return res.status(200).json({ rate, source: "alphavantage" });
      }
    }

    return res.status(503).json({ error: "Rate unavailable" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
