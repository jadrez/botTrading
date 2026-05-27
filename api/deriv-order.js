import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const SYMBOL_MAP = {
  "EUR/USD": "frxEURUSD", "GBP/USD": "frxGBPUSD", "USD/JPY": "frxUSDJPY",
  "AUD/USD": "frxAUDUSD", "NZD/USD": "frxNZDUSD", "USD/CHF": "frxUSDCHF",
  "USD/CAD": "frxUSDCAD", "EUR/GBP": "frxEURGBP",
};

// Try to get a WebSocket URL via OTP (new Deriv API for pat_xxx tokens)
async function getWsUrlViaOTP(token, appId) {
  const r = await fetch("https://api.deriv.com/otp", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Deriv-App-ID": String(appId),
      "Accept": "application/json",
    },
  });
  console.log("[deriv-order] OTP status:", r.status);
  const body = await r.text();
  console.log("[deriv-order] OTP body:", body);
  if (!r.ok) return null;
  try {
    const d = JSON.parse(body);
    return d.ws_url || d.websocket_url || d.url || null;
  } catch { return null; }
}

// Connect to WebSocket and execute one request
function connectWS(wsUrl, token, payload, needsAuthorize) {
  return new Promise((resolve, reject) => {
    console.log("[deriv-order] WS connect:", wsUrl, "| authorize:", needsAuthorize);
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Timeout connecting to Deriv WebSocket"));
    }, 15000);

    ws.on("open", () => {
      if (needsAuthorize) {
        console.log("[deriv-order] sending authorize");
        ws.send(JSON.stringify({ authorize: token }));
      } else {
        console.log("[deriv-order] sending payload (no auth needed)");
        ws.send(JSON.stringify(payload));
      }
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      console.log("[deriv-order] msg_type:", msg.msg_type, msg.error ? "ERR:" + JSON.stringify(msg.error) : "");
      if (msg.error) {
        clearTimeout(timer); ws.close();
        return reject(new Error(`Deriv error [${msg.error.code}]: ${msg.error.message}`));
      }
      if (msg.msg_type === "authorize") {
        console.log("[deriv-order] authorized loginid:", msg.authorize?.loginid, "— sending payload");
        ws.send(JSON.stringify(payload));
      } else {
        clearTimeout(timer); ws.close();
        resolve(msg);
      }
    });

    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function derivWS(token, payload, appId = "1089") {
  // 1) Try new API: get OTP-based WebSocket URL
  try {
    const wsUrl = await getWsUrlViaOTP(token, appId);
    if (wsUrl) {
      console.log("[deriv-order] OTP WS URL:", wsUrl);
      return await connectWS(wsUrl, token, payload, false);
    }
    console.log("[deriv-order] OTP did not return a WS URL, falling back");
  } catch (e) {
    console.log("[deriv-order] OTP approach error:", e.message);
  }

  // 2) Fallback: new WS endpoint with authorize
  const endpoints = [
    `wss://ws.derivws.com/websockets/v3?app_id=${appId}`,
    `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`,
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      return await connectWS(url, token, payload, true);
    } catch (e) {
      console.log("[deriv-order] endpoint", url, "failed:", e.message);
      lastErr = e;
    }
  }
  throw lastErr;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = process.env.DERIV_API_TOKEN;
  const appId = process.env.DERIV_APP_ID || "1089";
  console.log("[deriv-order] action:", req.body?.action, "| token present:", !!token, "| appId:", appId);
  if (!token) return res.status(500).json({ error: "DERIV_API_TOKEN not configured" });

  const { action, symbol, side, stake = 10, multiplier = 100, contractId, tpTarget = 3, slTarget = 2 } = req.body || {};

  try {
    // ── OPEN
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
      return res.status(200).json({ contractId: buy.contract_id, buyPrice: buy.buy_price, stake, multiplier, status: "OPEN" });
    }

    // ── CLOSE
    if (action === "close") {
      if (!contractId) return res.status(400).json({ error: "contractId required" });
      const result = await derivWS(token, { sell: contractId, price: 0 }, appId);
      const sell = result.sell;
      return res.status(200).json({
        contractId, sellPrice: sell?.sold_for ?? 0,
        pl: (sell?.sold_for ?? 0) - (sell?.buy_price ?? 0), status: "CLOSED",
      });
    }

    // ── BALANCE
    if (action === "balance") {
      const result = await derivWS(token, { balance: 1 }, appId);
      const bal = result.balance;
      return res.status(200).json({
        balance: bal.balance, currency: bal.currency,
        loginid: bal.loginid, demo: String(bal.loginid).startsWith("VR"),
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    console.error("[deriv-order] caught error:", e.message);
    return res.status(500).json({ error: e.message || String(e) });
  }
}
