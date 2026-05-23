const TAKE_PROFIT_USD = 3.00;
const STOP_LOSS_USD   = 2.00;
const MAX_POSITIONS   = 5;
const POSITION_USD    = 1000;

const fUSD = (n, sign=true) => (sign&&n>=0?"+":"")+`$${Math.abs(n).toFixed(2)}`;

function posPnL(pos, price) {
  const dir = pos.type === "BUY" ? 1 : -1;
  return dir * (price - pos.entry) / pos.entry * POSITION_USD;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  const {
    symbol = "ETH/USDT", price, rsi, macd, bb,
    ema9 = 0, ema21 = 0, volRatio = 1, trend1h = 0,
    patterns = [],
    positions, balance, news, reason,
  } = req.body;

  const nc = (news || []).slice(0, 4)
    .map(n => `[${n.sentiment.toUpperCase()}|${n.impact}] ${n.title}`)
    .join("\n") || "Sin noticias.";

  const pc = positions.length
    ? positions.map((p, i) => `#${i+1} ${p.type} PnL:${fUSD(posPnL(p, price))}`).join(" | ")
    : "Ninguna";

  const emaCross = ema9 > ema21 ? "EMA9>EMA21 ALCISTA" : "EMA9<EMA21 BAJISTA";
  const volStr   = volRatio > 1.5 ? "ALTO" : volRatio < 0.7 ? "BAJO" : "NORMAL";
  const patternsStr = patterns.length
    ? patterns.map(p=>`${p.name} (${p.signal} ${p.type} ${p.conf}%)`).join(", ")
    : "Ninguno detectado";

  const prompt = `Eres trader experto en ${symbol}. Decide si abrir UNA posición ahora.

PRECIO: ${price} | RSI: ${rsi?.toFixed(1)} ${rsi<30?"SOBREVENTA":rsi>70?"SOBRECOMPRA":"NEUTRAL"}
MACD HIST: ${macd?.hist?.toFixed(4)} ${macd?.hist>0?"ALCISTA":"BAJISTA"}
BB: precio ${price>bb?.upper?"SOBRE BANDA SUP":price<bb?.lower?"BAJO BANDA INF":"dentro de bandas"}
EMA: ${emaCross} | VOLUMEN: ${volStr} (×${volRatio?.toFixed(1)}) | TENDENCIA 1H: ${trend1h>=0?"+":""}${trend1h?.toFixed(2)}%
PATRONES CHARTISTAS: ${patternsStr}

NOTICIAS:
${nc}

PORTAFOLIO: $${balance?.toFixed(0)} | Posiciones: ${pc} | Slots: ${MAX_POSITIONS-positions.length}
TP: +$${TAKE_PROFIT_USD} | SL: -$${STOP_LOSS_USD} | Máx: ${MAX_POSITIONS} pos

REGLAS: Busca confluencia entre patrones + EMA + RSI + volumen + noticias. Si un patrón REVERSAL coincide con EMA y RSI → alta prioridad. Sin confluencia → HOLD.

Responde SOLO JSON sin backticks:
{"signal":"BUY","confidence":75,"reasoning":"máx 60 palabras en español","news_impact":"BULLISH","key_factor":"5 palabras","risk":"MEDIO","should_open":true}`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 250,
        temperature: 0.3,
        messages: [
          { role: "system", content: "Trader experto. Responde SOLO JSON válido sin texto extra ni backticks." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const d = await r.json();
    if (!r.ok) return res.status(r.status).json(d);

    const txt = d.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({
        signal: "HOLD", confidence: 40,
        reasoning: "Error al parsear respuesta.",
        news_impact: "NEUTRAL", key_factor: "Error análisis",
        risk: "ALTO", should_open: false,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
