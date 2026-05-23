const TAKE_PROFIT_USD = 1.20;
const STOP_LOSS_USD   = 2.00;
const MAX_POSITIONS   = 5;

const f5   = n => n.toFixed(5);
const fUSD = (n, sign=true) => (sign&&n>=0?"+":"")+`$${Math.abs(n).toFixed(2)}`;

function posPnL(pos, price) {
  const dir = pos.type === "BUY" ? 1 : -1;
  return dir * (price - pos.entry) * 100000 * 0.0001;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  const { symbol = "ETH/USDT", price, rsi, macd, bb, positions, balance, news, reason } = req.body;

  const nc = (news || []).slice(0, 5)
    .map(n => `[${n.sentiment.toUpperCase()}|${n.impact}] ${n.title}`)
    .join("\n") || "Sin noticias recientes.";

  const pc = positions.length
    ? positions.map((p, i) => `  #${i+1} ${p.type} @ ${f5(p.entry)} PnL:${fUSD(posPnL(p, price))}`).join("\n")
    : "  Ninguna";

  const prompt = `Eres un trader experto en ${symbol}. Analiza y decide si abrir UNA nueva posición.

CONTEXTO DEL ANÁLISIS: ${reason}

MERCADO ACTUAL:
Par: ${symbol}
Precio: ${price}
RSI(14): ${rsi.toFixed(2)} ${rsi<30?"→ SOBREVENTA":rsi>70?"→ SOBRECOMPRA":"→ NEUTRAL"}
MACD histograma: ${macd.hist.toFixed(6)} ${macd.hist>0?"→ MOMENTUM ALCISTA":"→ MOMENTUM BAJISTA"}
Bollinger: Superior ${f5(bb.upper)} | Media ${f5(bb.mid)} | Inferior ${f5(bb.lower)}
Precio vs BB: ${price>bb.upper?"SOBRE BANDA SUPERIOR — posible reversión bajista":price<bb.lower?"BAJO BANDA INFERIOR — posible reversión alcista":"DENTRO DE BANDAS"}

NOTICIAS EN VIVO:
${nc}

PORTAFOLIO ($${balance.toFixed(2)} balance):
Posiciones abiertas (${positions.length}/${MAX_POSITIONS}):
${pc}
Slots disponibles: ${MAX_POSITIONS-positions.length}

REGLAS DEL SISTEMA:
- Cada posición se cierra automáticamente en +$${TAKE_PROFIT_USD} (TP) o -$${STOP_LOSS_USD} (SL)
- Máximo ${MAX_POSITIONS} posiciones simultáneas
- Si las posiciones abiertas ya cubren la dirección del mercado, evita duplicar innecesariamente
- Si no hay confluencia clara entre indicadores y noticias → HOLD

Responde SOLO con JSON sin backticks ni markdown:
{"signal":"BUY","confidence":75,"reasoning":"análisis en español máx 80 palabras","news_impact":"BULLISH","key_factor":"factor decisivo 5 palabras","risk":"MEDIO","should_open":true}`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 400,
        temperature: 0.3,
        messages: [
          { role: "system", content: "Eres un trader Forex experto. Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin backticks, sin markdown." },
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
        reasoning: "Error al parsear respuesta de IA.",
        news_impact: "NEUTRAL", key_factor: "Error análisis",
        risk: "ALTO", should_open: false,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
