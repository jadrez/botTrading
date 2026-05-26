import crypto from "crypto";

const TESTNET_BASE = "https://testnet.binancefuture.com";
const PROD_BASE    = "https://fapi.binance.com";

// Symbol config: minimum quantity and step size for each futures pair
const SYM_CONFIG = {
  ETHUSDT:  { minQty: 0.001, step: 0.001, decimals: 3 },
  BTCUSDT:  { minQty: 0.001, step: 0.001, decimals: 3 },
  SOLUSDT:  { minQty: 0.1,   step: 0.1,   decimals: 1 },
};

function getBase() {
  return process.env.BINANCE_TESTNET !== "false" ? TESTNET_BASE : PROD_BASE;
}

function buildQuery(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function signQuery(query, secret) {
  const sig = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return `${query}&signature=${sig}`;
}

function calcQuantity(binanceSymbol, positionSizeUSD, price) {
  const cfg = SYM_CONFIG[binanceSymbol];
  if (!cfg) return null;
  const raw  = positionSizeUSD / price;
  const qty  = Math.floor(raw / cfg.step) * cfg.step;
  if (qty < cfg.minQty) return null;
  return parseFloat(qty.toFixed(cfg.decimals));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey    = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: "BINANCE_API_KEY / BINANCE_API_SECRET not configured" });
  }

  const { action, symbol, side, positionSize, price, quantity, clientOrderId } = req.body || {};
  const binanceSym = (symbol || "").replace("/", "");
  const base = getBase();

  try {
    // ── OPEN position (market order)
    if (action === "open") {
      const qty = calcQuantity(binanceSym, positionSize, price);
      if (!qty) {
        return res.status(400).json({
          error: `Cantidad muy pequeña para ${binanceSym}. Mínimo: ${SYM_CONFIG[binanceSym]?.minQty ?? "?"} contratos (~$${((SYM_CONFIG[binanceSym]?.minQty ?? 0.001) * price).toFixed(2)})`,
          minRequired: SYM_CONFIG[binanceSym]?.minQty,
        });
      }

      const params = {
        symbol:           binanceSym,
        side:             side,       // BUY | SELL
        type:             "MARKET",
        quantity:         qty,
        newClientOrderId: clientOrderId || `bot_${Date.now()}`,
        timestamp:        Date.now(),
      };

      const signed = signQuery(buildQuery(params), apiSecret);
      const r = await fetch(`${base}/fapi/v1/order`, {
        method:  "POST",
        headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
        body:    signed,
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.msg || "Binance error", code: d.code, raw: d });

      return res.status(200).json({
        orderId:    d.orderId,
        clientId:   d.clientOrderId,
        qty:        parseFloat(d.origQty),
        avgPrice:   parseFloat(d.avgPrice || price),
        status:     d.status,
        testnet:    process.env.BINANCE_TESTNET !== "false",
      });
    }

    // ── CLOSE position (reduceOnly market order)
    if (action === "close") {
      if (!quantity) return res.status(400).json({ error: "quantity requerido para cerrar" });

      const closeSide = side === "BUY" ? "SELL" : "BUY";
      const params = {
        symbol:     binanceSym,
        side:       closeSide,
        type:       "MARKET",
        quantity:   quantity,
        reduceOnly: "true",
        timestamp:  Date.now(),
      };

      const signed = signQuery(buildQuery(params), apiSecret);
      const r = await fetch(`${base}/fapi/v1/order`, {
        method:  "POST",
        headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
        body:    signed,
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.msg || "Binance error", code: d.code, raw: d });

      return res.status(200).json({
        orderId:  d.orderId,
        qty:      parseFloat(d.origQty),
        avgPrice: parseFloat(d.avgPrice || 0),
        status:   d.status,
      });
    }

    // ── GET account info (balance check)
    if (action === "balance") {
      const params  = { timestamp: Date.now() };
      const signed  = signQuery(buildQuery(params), apiSecret);
      const r = await fetch(`${base}/fapi/v2/account?${signed}`, {
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.msg, raw: d });
      const usdt = d.assets?.find(a => a.asset === "USDT");
      return res.status(200).json({
        availableBalance: parseFloat(usdt?.availableBalance || 0),
        walletBalance:    parseFloat(usdt?.walletBalance    || 0),
        unrealizedPnl:    parseFloat(usdt?.unrealizedProfit || 0),
      });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
