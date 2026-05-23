export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const today = new Date().toLocaleDateString("es-ES", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  const prompt = `Hoy es ${today}. Eres un analista Forex experto. Basándote en tu conocimiento del contexto macroeconómico actual de EUR/USD, genera un análisis de los factores que más probablemente estén afectando al par hoy: política monetaria BCE/Fed, inflación, empleo, PIB, geopolítica Europa/USA.

Responde SOLO con JSON sin backticks ni markdown:
{"headlines":[{"title":"titular breve en español","sentiment":"bullish","impact":"ALTO"},{"title":"titular breve en español","sentiment":"bearish","impact":"MEDIO"},{"title":"titular breve en español","sentiment":"neutral","impact":"BAJO"}],"market_bias":"bullish","summary":"resumen en 40 palabras del contexto actual EUR/USD"}

Genera exactamente 5 headlines realistas basados en el contexto macroeconómico actual. Los valores de sentiment solo pueden ser: bullish, bearish o neutral. Los valores de impact solo pueden ser: ALTO, MEDIO o BAJO.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
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
