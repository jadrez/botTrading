const PRACTICE_BASE = "https://api-fxpractice.oanda.com";
const LIVE_BASE     = "https://api-fxtrade.oanda.com";

// Mapping bot symbol → OANDA instrument
const INSTRUMENT_MAP = {
  "EUR/USD": "EUR_USD", "GBP/USD": "GBP_USD", "USD/JPY": "USD_JPY",
  "AUD/USD": "AUD_USD", "NZD/USD": "NZD_USD", "USD/CHF": "USD_CHF",
  "USD/CAD": "USD_CAD", "EUR/GBP": "EUR_GBP",
};

function getBase() {
  return process.env.OANDA_PRACTICE === "false" ? LIVE_BASE : PRACTICE_BASE;
}

// Calculate OANDA units from USD notional
// For pairs where USD is the quote (EUR/USD, GBP/USD...): units = positionUSD / price (base-currency units)
// For pairs where USD is the base (USD/JPY, USD/CHF...): units = positionUSD directly
// EUR/GBP is a cross pair — approximate via positionUSD / 1.15 (rough EUR/USD rate)
function calcUnits(symbol, positionSizeUSD, price, side) {
  let raw;
  if (symbol.startsWith("USD/")) {
    raw = positionSizeUSD;                       // 1 unit = 1 USD
  } else if (symbol === "EUR/GBP") {
    raw = positionSizeUSD / 1.15;                // approx: 1 EUR ≈ $1.15
  } else {
    raw = positionSizeUSD / price;               // base currency units
  }
  const units = Math.max(1, Math.round(raw));
  return side === "SELL" ? -units : units;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token     = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!token || !accountId) {
    return res.status(500).json({ error: "OANDA_API_TOKEN / OANDA_ACCOUNT_ID not configured" });
  }

  const base    = getBase();
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept-Datetime-Format": "UNIX" };
  const { action, symbol, side, positionSize, price, tradeId } = req.body || {};

  try {
    // ── OPEN position (market order)
    if (action === "open") {
      const instrument = INSTRUMENT_MAP[symbol];
      if (!instrument) return res.status(400).json({ error: `Símbolo no soportado: ${symbol}` });

      const units = calcUnits(symbol, positionSize, price, side);
      const r = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
        method: "POST", headers,
        body: JSON.stringify({
          order: { type: "MARKET", instrument, units: String(units), timeInForce: "FOK" },
        }),
      });
      const d = await r.json();
      if (!r.ok || d.errorMessage) {
        return res.status(r.status || 400).json({ error: d.errorMessage || "OANDA error", raw: d });
      }

      const fill = d.orderFillTransaction;
      if (!fill) return res.status(400).json({ error: "Orden no ejecutada (FOK)", raw: d });

      return res.status(200).json({
        tradeId:  fill.tradeOpened?.tradeID || null,
        units:    Math.abs(parseInt(fill.units || units)),
        avgPrice: parseFloat(fill.price || price),
        status:   "FILLED",
        practice: process.env.OANDA_PRACTICE !== "false",
      });
    }

    // ── CLOSE position
    if (action === "close") {
      if (!tradeId) return res.status(400).json({ error: "tradeId requerido para cerrar" });

      const r = await fetch(`${base}/v3/accounts/${accountId}/trades/${tradeId}/close`, {
        method: "PUT", headers, body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.errorMessage || "OANDA error", raw: d });

      const fill = d.orderFillTransaction;
      return res.status(200).json({
        tradeId,
        avgPrice: parseFloat(fill?.price || 0),
        pl:       parseFloat(fill?.pl || 0),
        status:   "CLOSED",
      });
    }

    // ── BALANCE / account summary
    if (action === "balance") {
      const r = await fetch(`${base}/v3/accounts/${accountId}/summary`, { headers });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.errorMessage || "OANDA error", raw: d });

      const acc = d.account;
      return res.status(200).json({
        balance:          parseFloat(acc.balance),
        availableBalance: parseFloat(acc.marginAvailable),
        unrealizedPnl:    parseFloat(acc.unrealizedPL),
        openTrades:       parseInt(acc.openTradeCount || 0),
        currency:         acc.currency || "USD",
        practice:         process.env.OANDA_PRACTICE !== "false",
      });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
