import crypto from "crypto";

const TESTNET_URL = "https://testnet.binance.vision";
const LIVE_URL    = "https://api.binance.com";

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  const testnet   = process.env.BINANCE_TESTNET === "true";

  if (!apiKey || !secretKey)
    return res.status(500).json({ error: "BINANCE_API_KEY / BINANCE_SECRET_KEY not set" });

  const BASE = testnet ? TESTNET_URL : LIVE_URL;

  try {
    const timestamp = Date.now();
    const qs  = `timestamp=${timestamp}&recvWindow=5000`;
    const sig = sign(qs, secretKey);

    const r = await fetch(`${BASE}/api/v3/account?${qs}&signature=${sig}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.msg || "Binance error", code: d.code });

    // Return only relevant balances (ignore dust < $0.01 equivalent)
    const relevant = ["USDT", "ETH", "BTC", "SOL", "BNB"];
    const balances = d.balances
      .filter(b => relevant.includes(b.asset))
      .map(b => ({
        asset: b.asset,
        free:  parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter(b => b.total > 0);

    return res.status(200).json({
      ok:        true,
      testnet:   testnet,
      balances,
      canTrade:  d.canTrade,
      makerFee:  d.makerCommission / 100,   // as percentage
      takerFee:  d.takerCommission / 100,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
