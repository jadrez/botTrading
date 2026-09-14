// Deriv's newer REST API (api.derivws.com/trading/v1/options) is auth'd with
// a Personal Access Token ("pat_..."), which is a DIFFERENT credential type
// from the classic ws.derivws.com "API token" — a pat_ token is rejected by
// the classic {"authorize": token} WebSocket message ("InvalidToken"), and a
// classic token / the public app_id=1089 is rejected here ("Invalid
// application"). Verified end-to-end against Deriv directly (curl + a throwaway
// ws script) before writing this, since this handles real trading:
//
//   1. GET  /trading/v1/options/accounts                        (Bearer + Deriv-App-ID)
//      -> [{ account_id, balance, currency, account_type: "demo"|"real", ... }]
//   2. POST /trading/v1/options/accounts/{account_id}/otp        (same headers)
//      -> { data: { url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=..." } }
//   3. Connect to that URL directly — the OTP in the URL IS the auth, no
//      separate `authorize` message. It's single-use and expires in 120s, so
//      steps 2-3 must happen back to back, per action (no caching the OTP).
//   4. Send ONE classic-shaped Deriv WS message and read the matching
//      response: {"balance":1}, {"buy":"1","price":...,"parameters":{...}},
//      or {"sell":contract_id,"price":0}.
//
// DERIV_APP_ID must be a real registered app id from developers.deriv.com
// (Register new application) — the classic public test id 1089 does NOT
// work against this REST product.
import WebSocket from "ws";

const REST_BASE = "https://api.derivws.com/trading/v1/options";

const SYMBOL_MAP = {
  "EUR/USD": "frxEURUSD", "GBP/USD": "frxGBPUSD", "USD/JPY": "frxUSDJPY",
  "AUD/USD": "frxAUDUSD", "NZD/USD": "frxNZDUSD", "USD/CHF": "frxUSDCHF",
  "USD/CAD": "frxUSDCAD", "EUR/GBP": "frxEURGBP",
};
const REVERSE_SYMBOL_MAP = Object.fromEntries(Object.entries(SYMBOL_MAP).map(([k, v]) => [v, k]));

function authHeaders(token, appId) {
  return { "Authorization": `Bearer ${token}`, "Deriv-App-ID": String(appId), "Content-Type": "application/json" };
}

async function pickAccount(token, appId, wantType) {
  const r = await fetch(`${REST_BASE}/accounts`, { headers: authHeaders(token, appId) });
  const text = await r.text();
  if (!r.ok) throw new Error(`accounts failed (${r.status}): ${text.slice(0, 300)}`);
  let data; try { data = JSON.parse(text); } catch { throw new Error(`accounts: non-JSON response: ${text.slice(0, 300)}`); }
  const accounts = data?.data || [];
  if (!accounts.length) throw new Error("No Deriv accounts found for this token");
  return accounts.find(a => a.account_type === wantType) || accounts[0];
}

async function getOtpWsUrl(token, appId, accountId) {
  const r = await fetch(`${REST_BASE}/accounts/${accountId}/otp`, { method: "POST", headers: authHeaders(token, appId) });
  const text = await r.text();
  if (!r.ok) throw new Error(`otp failed (${r.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const url = data?.data?.url;
  if (!url) throw new Error(`otp: no url in response: ${text.slice(0, 300)}`);
  return url;
}

// Connects to the OTP-authenticated URL, sends `request`, resolves with the
// first response carrying a msg_type (or rejects on an API error/timeout).
// The OTP is single-use — this connection is opened fresh per call.
function derivWsCall(wsUrl, request, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error("Deriv WS timeout")), timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(request)));
    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.error) {
        const detail = msg.error.details ? ` ${JSON.stringify(msg.error.details)}` : "";
        finish(reject, new Error(`${msg.error.code || "deriv_error"}: ${msg.error.message}${detail}`));
        return;
      }
      if (msg.msg_type) finish(resolve, msg);
    });
    ws.on("error", (e) => finish(reject, e));
    ws.on("close", () => finish(reject, new Error("Deriv WS closed before a response arrived")));
  });
}

// {"proposal_open_contract":1} with no contract_id sends ONE message PER
// currently-open contract (no array, no end-of-stream marker) — verified
// live: 0 open -> one empty {} message, 2 open -> two separate messages, in
// no particular order. Collect until `quietMs` passes with nothing new,
// bounded by `maxMs` as a hard cap.
function derivWsCollect(wsUrl, request, { quietMs = 800, maxMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = [];
    let settled = false, quietTimer = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(maxTimer); clearTimeout(quietTimer);
      try { ws.close(); } catch {}
      fn(arg);
    };
    const maxTimer = setTimeout(() => finish(resolve, results), maxMs);
    ws.on("open", () => ws.send(JSON.stringify(request)));
    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.error) { finish(reject, new Error(`${msg.error.code || "deriv_error"}: ${msg.error.message}`)); return; }
      if (msg.msg_type) {
        results.push(msg);
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(resolve, results), quietMs);
      }
    });
    ws.on("error", (e) => finish(reject, e));
  });
}

async function derivAction(token, appId, accountType, request) {
  const account = await pickAccount(token, appId, accountType);
  const wsUrl = await getOtpWsUrl(token, appId, account.account_id);
  const msg = await derivWsCall(wsUrl, request);
  return { msg, account };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = process.env.DERIV_API_TOKEN;
  const appId = process.env.DERIV_APP_ID;
  const accountType = process.env.DERIV_ACCOUNT_TYPE || "demo"; // switch to "real" only when deliberately going live
  if (!token) return res.status(500).json({ error: "DERIV_API_TOKEN not configured" });
  if (!appId) return res.status(500).json({ error: "DERIV_APP_ID not configured — register one at developers.deriv.com, the public 1089 id doesn't work on this API" });

  const { action, symbol, side, stake = 10, multiplier = 100, contractId, tpTarget = 3, slTarget = 2 } = req.body || {};

  try {
    // ── BALANCE
    if (action === "balance") {
      const { msg, account } = await derivAction(token, appId, accountType, { balance: 1 });
      return res.status(200).json({
        balance: msg.balance?.balance, currency: msg.balance?.currency, loginid: msg.balance?.loginid,
        accountType: account.account_type,
      });
    }

    // ── PORTFOLIO — every currently open real contract on the account, with
    // live spot/profit/commission/limit_order detail (used to sync Deriv's
    // own view of reality into the app, including positions opened manually
    // in DTrader that the app never knew about).
    if (action === "portfolio") {
      const account = await pickAccount(token, appId, accountType);
      const wsUrl = await getOtpWsUrl(token, appId, account.account_id);
      const msgs = await derivWsCollect(wsUrl, { proposal_open_contract: 1 });
      const positions = msgs
        .map(m => m.proposal_open_contract)
        .filter(c => c && c.contract_id) // the zero-open-contracts case is one empty {}
        .map(c => ({
          contractId: c.contract_id,
          symbol: REVERSE_SYMBOL_MAP[c.underlying_symbol] || c.underlying_symbol,
          type: c.contract_type === "MULTUP" ? "BUY" : "SELL",
          entry: parseFloat(c.entry_spot),
          currentSpot: parseFloat(c.current_spot),
          buyPrice: parseFloat(c.buy_price),
          multiplier: c.multiplier,
          profit: parseFloat(c.profit),
          commission: c.commission != null ? parseFloat(c.commission) : undefined,
          tp: c.limit_order?.take_profit ? Math.abs(c.limit_order.take_profit.order_amount) : undefined,
          sl: c.limit_order?.stop_loss ? Math.abs(c.limit_order.stop_loss.order_amount) : undefined,
          openTime: c.purchase_time ? c.purchase_time * 1000 : undefined,
        }));
      return res.status(200).json({ positions });
    }

    // ── OPEN (buy)
    if (action === "open") {
      const derivSymbol = SYMBOL_MAP[symbol];
      if (!derivSymbol) return res.status(400).json({ error: `Symbol not supported: ${symbol}` });

      const buyRequest = {
        buy: "1",
        price: stake, // max acceptable price — for basis:"stake" this equals the stake itself
        parameters: {
          contract_type: side === "BUY" ? "MULTUP" : "MULTDOWN",
          underlying_symbol: derivSymbol, // NOT "symbol" — this REST/OTP product rejects that key
          currency: "USD",
          amount: stake,
          basis: "stake",
          multiplier,
          limit_order: { take_profit: tpTarget, stop_loss: slTarget },
        },
      };

      const { msg } = await derivAction(token, appId, accountType, buyRequest);
      const b = msg.buy;
      return res.status(200).json({ contractId: b?.contract_id, buyPrice: b?.buy_price, stake, multiplier, status: "OPEN", raw: b });
    }

    // ── CLOSE (sell)
    if (action === "close") {
      if (!contractId) return res.status(400).json({ error: "contractId required" });

      const { msg } = await derivAction(token, appId, accountType, { sell: Number(contractId), price: 0 });
      const s = msg.sell;
      return res.status(200).json({ contractId, sellPrice: s?.sold_for, status: "CLOSED", raw: s });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    console.error("[deriv-order] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
