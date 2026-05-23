export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const prompt = `Busca en internet las noticias más recientes de hoy que afecten al par EUR/USD en el mercado Forex. Considera: datos macroeconómicos USA/Eurozona, declaraciones BCE/Fed, inflación, empleo, PIB, geopolítica.

Responde SOLO con JSON sin backticks:
{"headlines":[{"title":"titular breve español","sentiment":"bullish"|"bearish"|"neutral","impact":"ALTO"|"MEDIO"|"BAJO"}],"market_bias":"bullish"|"bearish"|"neutral","summary":"resumen 40 palabras"}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 700,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const d = await r.json();
    if (!r.ok) return res.status(r.status).json(d);

    const txt = (d.content || []).map((b) => b.text || "").join("");
    try {
      const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({ headlines: [], market_bias: "neutral", summary: "Sin noticias disponibles." });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
