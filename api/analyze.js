const MAX_POSITIONS    = 5;
const DEFAULT_STAKE    = 10.00;
const DEFAULT_MULT     = 100;
const DEFAULT_TP_USD   = 6.00;
const DEFAULT_SL_USD   = 3.00;

// Server-side safety net mirroring SYMBOL_STRATEGY in src/trading-bot-v3.jsx —
// so a direct call to this endpoint can't bypass the UI's auto-trading gate.
// This hardcoded set is only the FALLBACK: getSinEdgeSymbols() below prefers
// the live `symbol_strategy` table (kept fresh by backtest/update-strategy.mjs
// on a schedule) so tier changes don't need a code edit + redeploy here too.
const FALLBACK_SIN_EDGE_SYMBOLS = new Set(["SOL/USDT", "EUR/GBP", "XAG/USD", "XTI/USD"]);

let sinEdgeCache = { set: null, fetchedAt: 0 };
const SIN_EDGE_CACHE_TTL_MS = 10 * 60 * 1000; // serverless instances stay warm for minutes, not hours

async function getSinEdgeSymbols() {
  if (sinEdgeCache.set && Date.now() - sinEdgeCache.fetchedAt < SIN_EDGE_CACHE_TTL_MS) {
    return sinEdgeCache.set;
  }
  if (!process.env.DATABASE_URL) return FALLBACK_SIN_EDGE_SYMBOLS;
  try {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const r = await pool.query(`SELECT symbol FROM symbol_strategy WHERE tier = 'SIN-EDGE'`);
    await pool.end();
    if (r.rows.length === 0) return FALLBACK_SIN_EDGE_SYMBOLS; // table not populated yet — don't wipe the safety net
    const set = new Set(r.rows.map(row => row.symbol));
    sinEdgeCache = { set, fetchedAt: Date.now() };
    return set;
  } catch {
    return FALLBACK_SIN_EDGE_SYMBOLS; // DB hiccup — fail safe to the hardcoded list, never fail open
  }
}

const fUSD = (n, sign=true) => {
  const abs=Math.abs(n);
  const dec=abs<0.01?4:abs<0.10?3:2;
  return (sign&&n>=0?"+":"")+`$${abs.toFixed(dec)}`;
};

// Deriv multiplier PnL: stake × multiplier × (Δprice / entry)
function posPnL(pos, price, stake=DEFAULT_STAKE) {
  const dir  = pos.type === "BUY" ? 1 : -1;
  const mult = pos.multiplier || DEFAULT_MULT;
  return dir * (price - pos.entry) / pos.entry * stake * mult;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  const {
    symbol = "ETH/USDT", price, rsi, macd, bb,
    ema9 = 0, ema21 = 0, volRatio = 1, trend1h = 0,
    shortTrend = { pct: 0, bullish: 0, bearish: 0, direction: "NEUTRAL" },
    consecutiveLosses = 0,
    ema200 = 0,
    srLevels = { supports: [], resistances: [] },
    patterns = [],
    correlations = [],
    positions, balance, news, marketBias = "neutral", newsSummary = "", reason,
    activePrediction = null,
    positionSize = DEFAULT_STAKE,
    tpTarget = DEFAULT_TP_USD,
    slTarget = DEFAULT_SL_USD,
  } = req.body;
  const POSITION_USD    = positionSize > 0 ? positionSize : DEFAULT_STAKE;
  const TAKE_PROFIT_USD = tpTarget > 0 ? tpTarget : DEFAULT_TP_USD;
  const STOP_LOSS_USD   = slTarget > 0 ? slTarget : DEFAULT_SL_USD;

  const nc = (news || []).slice(0, 4)
    .map(n => `[${n.sentiment.toUpperCase()}|${n.impact}] ${n.title}`)
    .join("\n") || "Sin noticias.";

  const pc = positions.length
    ? positions.map((p, i) => `#${i+1} ${p.type} PnL:${fUSD(posPnL(p, price, POSITION_USD))}`).join(" | ")
    : "Ninguna";

  const emaCross    = ema9 > ema21 ? "EMA9>EMA21 (ALCISTA)" : "EMA9<EMA21 (BAJISTA)";
  const ema200Dir   = ema200 > 0 ? (price > ema200 ? `precio SOBRE EMA200 → ALCISTA LARGO PLAZO` : `precio BAJO EMA200 → BAJISTA LARGO PLAZO`) : "EMA200 no disponible";
  const nearSupport = srLevels.supports?.slice(0,2).map(s=>`S@${s.price?.toFixed(2)}(×${s.touches})`).join(" ") || "ninguno";
  const nearResist  = srLevels.resistances?.slice(0,2).map(r=>`R@${r.price?.toFixed(2)}(×${r.touches})`).join(" ") || "ninguno";
  const volStr      = volRatio > 1.5 ? "ALTO" : volRatio < 0.7 ? "BAJO" : "NORMAL";
  const patternsStr = patterns.length
    ? patterns.map(p => `${p.name}(${p.signal} ${p.conf}%)`).join(", ")
    : "Ninguno";

  // ── Derive dominant trend direction from objective signals
  const emaDir   = ema9 > ema21 ? "BULLISH" : "BEARISH";
  const rsiDir   = rsi < 40 ? "BEARISH" : rsi > 60 ? "BULLISH" : "NEUTRAL";
  const t1hDir   = trend1h > 0.1 ? "BULLISH" : trend1h < -0.1 ? "BEARISH" : "NEUTRAL";
  const stDir    = shortTrend?.direction || "NEUTRAL";

  // Count how many signals agree on direction
  const signals  = [emaDir, rsiDir, t1hDir, stDir];
  const bullCount = signals.filter(s => s === "BULLISH").length;
  const bearCount = signals.filter(s => s === "BEARISH").length;
  const dominantTrend = bearCount >= 3 ? "BAJISTA FUERTE"
    : bearCount === 2 ? "BAJISTA"
    : bullCount >= 3 ? "ALCISTA FUERTE"
    : bullCount === 2 ? "ALCISTA"
    : "LATERAL";

  // ── Correlation context
  let corrStr = "Sin datos de correlación (par no-forex o sin historial).";
  let confirmCount = 0;
  const corrCount = correlations.length;
  if (corrCount > 0) {
    confirmCount = correlations.filter(c => c.confirms).length;
    corrStr = correlations.map(c =>
      `${c.symbol}: ${c.signal} (corr ${c.direction > 0 ? "+" : "-"}1) → ${c.confirms ? "✓ CONFIRMA" : "✗ CONTRADICE"}`
    ).join("\n");
  }
  const corrSummary = corrCount > 0
    ? `${confirmCount}/${corrCount} pares confirman. ${
        confirmCount === corrCount ? "MÁXIMA CONFLUENCIA ▲▲" :
        confirmCount === 0 ? "⚠️ NINGÚN PAR CONFIRMA → señal muy débil." :
        "Confluencia parcial — actúa con precaución."}`
    : "";

  // Consecutive loss warning
  const lossWarning = consecutiveLosses >= 2
    ? `⚠️ ALERTA: ${consecutiveLosses} pérdidas consecutivas. Exige confluencia perfecta (conf≥75%) o responde HOLD.`
    : consecutiveLosses === 1
    ? `Nota: 1 pérdida reciente. Sé más estricto con la confluencia.`
    : "";

  // Active prediction context
  const activePredCtx = activePrediction
    ? `Señal activa: ${activePrediction.signal} desde hace ~${Math.floor((Date.now()-(activePrediction.timestamp||Date.now()))/60000)}min, ${activePrediction.confirmations||1} confirmación(es), ${activePrediction.invalidations||0} invalidación(es). Entrada señalada: ${activePrediction.entryPrice}. ¿Confirmas mantener esta señal o hay evidencia clara de cambio?`
    : "Sin señal activa. Evalúa si hay condición de inicio válida.";

  const prompt = `Eres trader experto en ${symbol}. Analiza y decide si abrir UNA posición.

═══ INDICADORES ═══
PRECIO: ${price}
RSI(14): ${rsi?.toFixed(1)} ${rsi<30?"⚠ SOBREVENTA":rsi>70?"⚠ SOBRECOMPRA":"neutro"}
MACD Hist: ${macd?.hist?.toFixed(4)} ${macd?.hist>0?"▲ ALCISTA":"▼ BAJISTA"}
BB: precio ${price>bb?.upper?"SOBRE BANDA SUP ⚠":price<bb?.lower?"BAJO BANDA INF ⚠":"dentro de bandas"}
EMA: ${emaCross}
VOLUMEN: ${volStr} (×${volRatio?.toFixed(1)})
TENDENCIA 1H: ${trend1h>=0?"+":""}${trend1h?.toFixed(2)}%
TENDENCIA 5 VELAS: ${shortTrend?.pct?.toFixed(3)}% | ${shortTrend?.bullish} alcistas / ${shortTrend?.bearish} bajistas → ${stDir}
EMA 200: ${ema200Dir}
SOPORTE cercano: ${nearSupport}
RESISTENCIA cercana: ${nearResist}
PATRONES (velas + chartistas): ${patternsStr}

═══ TENDENCIA DOMINANTE: ${dominantTrend} ═══
(EMA:${emaDir} | RSI:${rsiDir} | 1H:${t1hDir} | 5V:${stDir})

═══ NOTICIAS ═══
Sesgo agregado (Alpha Vantage, todas las noticias recientes): ${marketBias.toUpperCase()}
${newsSummary || ""}
Titulares:
${nc}

═══ CORRELACIÓN FOREX ═══
${corrStr}
${corrSummary}

═══ PREDICCIÓN ACTIVA ═══
${activePredCtx}

═══ PORTAFOLIO ═══
Balance: $${balance?.toFixed(0)} | Posiciones: ${pc} | Slots: ${MAX_POSITIONS-positions.length}
TP: +$${TAKE_PROFIT_USD} | SL: -$${STOP_LOSS_USD}
${lossWarning}

═══ REGLAS ESTRICTAS ═══
1. SIGUE LA TENDENCIA DOMINANTE. Si es BAJISTA→ solo SELL. Si es ALCISTA→ solo BUY. Si es LATERAL→ HOLD.
2. NUNCA operes contra la tendencia. Si EMA9<EMA21 Y tendencia 5 velas es BEARISH → NO abrir BUY.
3. EMA200 es la tendencia principal. Si precio < EMA200 → mercado bajista de fondo, prefiere SELL.
4. Requiere mínimo 2 señales confirmando: EMA + RSI, o EMA + patrón vela, o S/R + patrón chartista.
5. Si precio toca SOPORTE y hay Hammer/Engulfing alcista → alta prioridad BUY.
6. Si precio toca RESISTENCIA y hay Shooting Star/Engulfing bajista → alta prioridad SELL.
7. Si tendencia BAJISTA FUERTE y posiciones BUY abiertas → signal=HOLD, should_open=false.
8. ${consecutiveLosses>=2?"MODO CONSERVADOR: conf mínima 75%.":"Confianza mínima: 65%."}
9. Sin confluencia clara → HOLD siempre.
10. CORRELACIÓN: Si hay datos de correlación forex y 0 pares confirman → should_open=false, HOLD obligatorio.
11. CORRELACIÓN: Si TODOS los pares correlacionados confirman → suma +8% a la confianza y prioriza la apertura.
12. NOTICIAS: El sesgo agregado NO es un titular suelto — es el promedio de sentimiento de TODAS las noticias recientes. Si contradice fuertemente tu señal (ej. sesgo BAJISTA y quieres BUY), exige confluencia técnica extra antes de abrir; si confirma tu señal, es una razón válida para subir la confianza.

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
        // llama-3.3-70b-versatile was deprecated by Groq on 2026-08-16 for
        // free/developer tiers (enterprise-only now). openai/gpt-oss-120b is
        // Groq's recommended replacement at comparable capability. Overridable
        // via GROQ_MODEL so a future Groq deprecation doesn't need a redeploy.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        max_tokens: 320,
        temperature: 0.15,
        messages: [
          { role: "system", content: "Eres un trader algorítmico experto en forex y crypto. Analizas contexto técnico complejo, correlaciones entre pares y sentimiento de noticias. Sigues la tendencia dominante. Nunca operas contra ella. Respondes SOLO JSON válido sin texto adicional." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const d = await r.json();
    if (!r.ok) return res.status(r.status).json(d);

    const txt = d.choices?.[0]?.message?.content || "";
    try {
      // openai/gpt-oss-120b is a reasoning model — it can prepend visible
      // chain-of-thought (often wrapped in <think>...</think> or similar)
      // before the actual JSON despite the "respond ONLY JSON" instruction.
      // Strip that, then fall back to pulling out the first {...} block if
      // the response still isn't valid JSON on its own.
      let cleaned = txt.replace(/```json|```/g, "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
        .trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON object found in model response");
        parsed = JSON.parse(match[0]);
      }

      // Hard override: symbol has no walk-forward-validated edge — never open.
      const sinEdgeSymbols = await getSinEdgeSymbols();
      if (sinEdgeSymbols.has(symbol) && parsed.should_open) {
        return res.status(200).json({
          ...parsed,
          signal: "HOLD",
          should_open: false,
          confidence: Math.min(parsed.confidence, 40),
          reasoning: `[Bloqueado] ${symbol} sin ventaja validada en walk-forward (0/4 folds rentables). ${parsed.reasoning}`,
          key_factor: "Símbolo sin edge validado",
        });
      }

      // Recompute confirmCount based on the AI's actual signal (fixes BUY-only bias)
      // A corr pair CONFIRMS when it moves in the direction expected given its correlation + the signal
      let finalConfirmCount = 0;
      if (corrCount > 0 && parsed.signal !== "HOLD") {
        finalConfirmCount = correlations.filter(c => {
          if (parsed.signal === "BUY")
            return (c.direction > 0 && c.signal === "BUY") || (c.direction < 0 && c.signal === "SELL");
          if (parsed.signal === "SELL")
            return (c.direction > 0 && c.signal === "SELL") || (c.direction < 0 && c.signal === "BUY");
          return false;
        }).length;
      }

      // Hard override: if dominant trend is strongly bearish and signal is BUY → force HOLD
      if ((bearCount >= 3) && parsed.signal === "BUY") {
        return res.status(200).json({
          ...parsed,
          signal: "HOLD",
          should_open: false,
          confidence: Math.min(parsed.confidence, 45),
          reasoning: `[Bloqueado] Tendencia dominante BAJISTA (${dominantTrend}). ${parsed.reasoning}`,
          key_factor: "Tendencia bajista bloqueó BUY",
        });
      }
      // Hard override: if dominant trend is strongly bullish and signal is SELL → force HOLD
      if ((bullCount >= 3) && parsed.signal === "SELL") {
        return res.status(200).json({
          ...parsed,
          signal: "HOLD",
          should_open: false,
          confidence: Math.min(parsed.confidence, 45),
          reasoning: `[Bloqueado] Tendencia dominante ALCISTA (${dominantTrend}). ${parsed.reasoning}`,
          key_factor: "Tendencia alcista bloqueó SELL",
        });
      }
      // Hard override: correlations available but NONE confirm (based on actual signal direction)
      if (corrCount >= 2 && finalConfirmCount === 0 && parsed.signal !== "HOLD") {
        return res.status(200).json({
          ...parsed,
          signal: "HOLD",
          should_open: false,
          confidence: Math.min(parsed.confidence, 38),
          reasoning: `[Bloqueado por correlación] 0/${corrCount} pares confirman señal ${parsed.signal}. Sin confluencia inter-mercado. ${parsed.reasoning}`,
          key_factor: "Correlación contradice señal",
        });
      }
      // Boost confidence when ALL correlations confirm the actual signal
      if (corrCount >= 2 && finalConfirmCount === corrCount && parsed.should_open) {
        return res.status(200).json({
          ...parsed,
          confidence: Math.min(99, parsed.confidence + 8),
          reasoning: `[Confirmado por correlación ${corrCount}/${corrCount}] ${parsed.reasoning}`,
          key_factor: parsed.key_factor + " · corr✓✓",
        });
      }

      // News-bias adjustment: the aggregate sentiment from ALL recent
      // headlines (not a single stray one) either backs or contradicts the
      // final signal. Softer than the trend/correlation hard blocks —
      // sentiment analysis is noisier than price action — so this nudges
      // confidence rather than forcing HOLD outright.
      const biasDir = marketBias === "bullish" ? "BUY" : marketBias === "bearish" ? "SELL" : null;
      if (biasDir && parsed.signal !== "HOLD" && parsed.signal !== biasDir) {
        return res.status(200).json({
          ...parsed,
          confidence: Math.max(0, parsed.confidence - 10),
          reasoning: `[Noticias en contra: sesgo ${marketBias.toUpperCase()}] ${parsed.reasoning}`,
          key_factor: parsed.key_factor + " · noticias✗",
        });
      }
      if (biasDir && parsed.signal === biasDir) {
        return res.status(200).json({
          ...parsed,
          confidence: Math.min(99, parsed.confidence + 5),
          reasoning: `[Confirmado por noticias: sesgo ${marketBias.toUpperCase()}] ${parsed.reasoning}`,
          key_factor: parsed.key_factor + " · noticias✓",
        });
      }

      return res.status(200).json(parsed);
    } catch (parseErr) {
      // Logged (not returned to the client) so a repeat of this is
      // diagnosable from Vercel's function logs instead of guessing blind.
      console.error("analyze.js: could not parse model response as JSON:", parseErr.message, "raw:", txt.slice(0, 500));
      return res.status(200).json({
        signal: "HOLD", confidence: 40,
        reasoning: "El modelo de IA no devolvió una respuesta interpretable esta vez — HOLD por seguridad. Si se repite seguido, contacta soporte con esto en mente: puede requerir ajustar el prompt para el modelo actual.",
        news_impact: "NEUTRAL", key_factor: "Error análisis",
        risk: "ALTO", should_open: false,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
