import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const SYMBOL_MAP = {
  "EUR/USD": "frxEURUSD", "GBP/USD": "frxGBPUSD", "USD/JPY": "frxUSDJPY",
  "AUD/USD": "frxAUDUSD", "NZD/USD": "frxNZDUSD", "USD/CHF": "frxUSDCHF",
  "USD/CAD": "frxUSDCAD", "EUR/GBP": "frxEURGBP",
};

// Send one request over a fresh WebSocket connection (authorize → request → result → close)
function derivWS(token, payload, appId = "1089") {
  return new Promise((resolve, reject) => {
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`;
    console.log("[deriv-order] connecting to", url);
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      console.error("[deriv-order] TIMEOUT after 15s");
      ws.terminate();
      reject(new Error("Timeout connecting to Deriv WebSocket"));
    }, 15000);

    ws.on("open", () => {
      console.log("[deriv-order] WS open — sending authorize");
      ws.send(JSON.stringify({ authorize: token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      console.log("[deriv-order] msg_type:", msg.msg_type, msg.error ? "ERROR:" + JSON.stringify(msg.error) : "");
      if (msg.error) {
        clearTimeout(timer);
        ws.close();
        return reject(new Error(`Deriv error [${msg.error.code}]: ${msg.error.message}`));
      }
      if (msg.msg_type === "authorize") {
        console.log("[deriv-order] authorized as", msg.authorize?.loginid, "— sending payload:", JSON.stringify(payload));
        ws.send(JSON.stringify(payload));
      } else {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });

    ws.on("error", (e) => {
      console.error("[deriv-order] WS error:", e.message);
      clearTimeout(timer);
      reject(e);
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = process.env.DERIV_API_TOKEN;
  const appId = process.env.DERIV_APP_ID || "1089";
  console.log("[deriv-order] action:", req.body?.action, "| token present:", !!token, "| appId:", appId);
  if (!token) return res.status(500).json({ error: "DERIV_API_TOKEN not configured" });

  const { action, symbol, side, stake = 10, multiplier = 100, contractId, tpTarget = 3, slTarget = 2 } = req.body || {};

  try {
    // ── OPEN — multiplier contract (MULTUP = BUY, MULTDOWN = SELL)
    if (action === "open") {
      const derivSymbol = SYMBOL_MAP[symbol];
      if (!derivSymbol) return res.status(400).json({ error: `Symbol not supported: ${symbol}` });

      const result = await derivWS(token, {
        buy: "1",
        price: stake,
        parameters: {
          contract_type: side === "BUY" ? "MULTUP" : "MULTDOWN",
          symbol: derivSymbol,
          amount: stake,
          multiplier,
          limit_order: { take_profit: tpTarget, stop_loss: slTarget },
          basis: "stake",
          currency: "USD",
        },
      }, appId);

      const buy = result.buy;
      if (!buy) return res.status(400).json({ error: "Contract not opened", raw: result });

      return res.status(200).json({
        contractId: buy.contract_id,
        buyPrice:   buy.buy_price,
        stake,
        multiplier,
        status: "OPEN",
      });
    }

    // ── CLOSE — sell contract at market
    if (action === "close") {
      if (!contractId) return res.status(400).json({ error: "contractId required" });

      const result = await derivWS(token, { sell: contractId, price: 0 }, appId);
      const sell = result.sell;

      return res.status(200).json({
        contractId,
        sellPrice: sell?.sold_for ?? 0,
        pl:        (sell?.sold_for ?? 0) - (sell?.buy_price ?? 0),
        status:    "CLOSED",
      });
    }

    // ── BALANCE
    if (action === "balance") {
      const result = await derivWS(token, { balance: 1 }, appId);
      const bal = result.balance;

      return res.status(200).json({
        balance:  bal.balance,
        currency: bal.currency,
        loginid:  bal.loginid,
        demo:     String(bal.loginid).startsWith("VR"),
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    console.error("[deriv-order] caught error:", e.message || String(e));
    return res.status(500).json({ error: e.message || String(e) });
  }
}
