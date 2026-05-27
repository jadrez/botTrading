// New Deriv REST API — base: https://api.derivws.com/trading/v1/options
// Auth: Authorization: Bearer <pat_token>  +  Deriv-App-ID: <app_id>

const DERIV_BASE = "https://api.derivws.com/trading/v1/options";

const SYMBOL_MAP = {
  "EUR/USD": "frxEURUSD", "GBP/USD": "frxGBPUSD", "USD/JPY": "frxUSDJPY",
  "AUD/USD": "frxAUDUSD", "NZD/USD": "frxNZDUSD", "USD/CHF": "frxUSDCHF",
  "USD/CAD": "frxUSDCAD", "EUR/GBP": "frxEURGBP",
};

function derivHeaders(token, appId) {
  return {
    "Authorization": `Bearer ${token}`,
    "Deriv-App-ID": String(appId),
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function derivREST(method, path, token, appId, body) {
  const url = `${DERIV_BASE}${path}`;
  console.log("[deriv-order]", method, url, body ? JSON.stringify(body) : "");
  const r = await fetch(url, {
    method,
    headers: derivHeaders(token, appId),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  console.log("[deriv-order] status:", r.status, "body:", text.slice(0, 500));
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = process.env.DERIV_API_TOKEN;
  const appId = process.env.DERIV_APP_ID || "1089";
  console.log("[deriv-order] action:", req.body?.action, "| token present:", !!token, "| appId:", appId);
  if (!token) return res.status(500).json({ error: "DERIV_API_TOKEN not configured" });

  const { action, symbol, side, stake = 10, multiplier = 100, contractId, tpTarget = 3, slTarget = 2 } = req.body || {};

  try {
    // ── BALANCE
    if (action === "balance") {
      // Try to get account info first to find the loginid
      const acct = await derivREST("GET", "/accounts", token, appId);
      if (!acct.ok) return res.status(acct.status).json({ error: "balance failed", detail: acct.data });

      // Try accounts list or direct balance endpoint
      const accounts = acct.data?.accounts || acct.data?.data || acct.data;
      console.log("[deriv-order] accounts response:", JSON.stringify(acct.data).slice(0, 300));

      // Return raw data so we can see the structure
      return res.status(200).json({ raw: acct.data, _debug: true });
    }

    // ── OPEN
    if (action === "open") {
      const derivSymbol = SYMBOL_MAP[symbol];
      if (!derivSymbol) return res.status(400).json({ error: `Symbol not supported: ${symbol}` });

      const body = {
        contract_type: side === "BUY" ? "MULTUP" : "MULTDOWN",
        symbol: derivSymbol,
        amount: stake,
        multiplier,
        limit_order: { take_profit: tpTarget, stop_loss: slTarget },
        basis: "stake",
        currency: "USD",
      };

      const r = await derivREST("POST", "/contracts", token, appId, body);
      console.log("[deriv-order] open response:", JSON.stringify(r.data).slice(0, 500));
      if (!r.ok) return res.status(r.status).json({ error: "open failed", detail: r.data });

      const d = r.data?.data || r.data;
      return res.status(200).json({ contractId: d?.contract_id || d?.id, buyPrice: d?.buy_price, stake, multiplier, status: "OPEN", raw: d });
    }

    // ── CLOSE
    if (action === "close") {
      if (!contractId) return res.status(400).json({ error: "contractId required" });

      const r = await derivREST("DELETE", `/contracts/${contractId}`, token, appId);
      console.log("[deriv-order] close response:", JSON.stringify(r.data).slice(0, 500));
      if (!r.ok) return res.status(r.status).json({ error: "close failed", detail: r.data });

      const d = r.data?.data || r.data;
      return res.status(200).json({ contractId, sellPrice: d?.sell_price || d?.sold_for || 0, status: "CLOSED", raw: d });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    console.error("[deriv-order] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
