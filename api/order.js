import crypto from "crypto";

const TESTNET_URL = "https://testnet.binance.vision";
const LIVE_URL    = "https://api.binance.com";

// Symbol config: quoteOrderQty lets us send USDT amount directly, avoiding lot-size issues
const SYMBOL_MAP = {
  "ETH/USDT": "ETHUSDT",
  "BTC/USDT": "BTCUSDT",
  "SOL/USDT": "SOLUSDT",
};

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

function buildQuery(params) {
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  const testnet   = process.env.BINANCE_TESTNET === "true";

  if (!apiKey || !secretKey)
    return res.status(500).json({ error: "BINANCE_API_KEY / BINANCE_SECRET_KEY not set" });

  const { action, symbol, side, positionUsd = 50 } = req.body;
  // action: "open" | "close"
  // side:   "BUY"  | "SELL"
  // positionUsd: USDT amount to trade (default $50 for safety)

  const binanceSymbol = SYMBOL_MAP[symbol];
  if (!binanceSymbol)
    return res.status(400).json({ error: `Symbol ${symbol} not supported for real trading` });

  const BASE = testnet ? TESTNET_URL : LIVE_URL;

  try {
    if (action === "open") {
      // Market order using quoteOrderQty (USDT amount) — avoids lot size calculation
      const params = {
        symbol:        binanceSymbol,
        side:          side,              // BUY or SELL
        type:          "MARKET",
        quoteOrderQty: positionUsd,       // spend exactly this USDT amount
        timestamp:     Date.now(),
        recvWindow:    5000,
      };
      const qs  = buildQuery(params);
      const sig = sign(qs, secretKey);

      const r = await fetch(`${BASE}/api/v3/order?${qs}&signature=${sig}`, {
        method: "POST",
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.msg || "Binance error", code: d.code });

      return res.status(200).json({
        ok: true,
        orderId:     d.orderId,
        symbol:      d.symbol,
        side:        d.side,
        status:      d.status,
        executedQty: d.executedQty,
        fills:       d.fills,
        // Average fill price
        avgPrice: d.fills?.length
          ? d.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0)
            / d.fills.reduce((s, f) => s + parseFloat(f.qty), 0)
          : null,
      });
    }

    if (action === "close") {
      // To close: sell the exact quantity we hold (opposite side)
      const { quantity } = req.body;
      if (!quantity) return res.status(400).json({ error: "quantity required to close" });

      const params = {
        symbol:    binanceSymbol,
        side:      side,       // opposite of opening side
        type:      "MARKET",
        quantity:  quantity,   // exact base asset qty to close
        timestamp: Date.now(),
        recvWindow: 5000,
      };
      const qs  = buildQuery(params);
      const sig = sign(qs, secretKey);

      const r = await fetch(`${BASE}/api/v3/order?${qs}&signature=${sig}`, {
        method: "POST",
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.msg || "Binance error", code: d.code });

      return res.status(200).json({
        ok: true,
        orderId:     d.orderId,
        side:        d.side,
        status:      d.status,
        executedQty: d.executedQty,
        avgPrice: d.fills?.length
          ? d.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0)
            / d.fills.reduce((s, f) => s + parseFloat(f.qty), 0)
          : null,
      });
    }

    return res.status(400).json({ error: "action must be 'open' or 'close'" });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
