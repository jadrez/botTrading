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

// Convert lots to OANDA units: 1 standard lot = 100,000 units of base currency
// e.g. 0.10 lots EUR/USD = 10,000 EUR; 0.10 lots USD/JPY = 10,000 USD
function calcUnits(lots, side) {
  const units = Math.max(1, Math.round(lots * 100000));
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
  const { action, symbol, side, lots, tradeId } = req.body || {};

  try {
    // ── OPEN position (market order)
    if (action === "open") {
      const instrument = INSTRUMENT_MAP[symbol];
      if (!instrument) return res.status(400).json({ error: `Símbolo no soportado: ${symbol}` });

      const units = calcUnits(lots || 0.10, side);
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
        lots:     Math.abs(units) / 100000,
        avgPrice: parseFloat(fill.price || 0),
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

    // ── LIVE PRICE — real-time bid/ask mid for a symbol
    if (action === "price") {
      const instrument = INSTRUMENT_MAP[symbol];
      if (!instrument) return res.status(400).json({ error: `Símbolo no soportado: ${symbol}` });

      const r = await fetch(`${base}/v3/accounts/${accountId}/pricing?instruments=${instrument}`, { headers });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.errorMessage || "OANDA error" });

      const p = d.prices?.[0];
      if (!p || !p.tradeable) return res.status(400).json({ error: "Precio no disponible" });

      const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk);
      const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid);
      return res.status(200).json({ ask, bid, mid: (ask + bid) / 2 });
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
