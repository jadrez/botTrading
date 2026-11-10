#!/usr/bin/env node
// Production server for Fly.io — replaces Vercel's static-hosting +
// serverless-functions split with a single Node process: serves the Vite
// build from dist/ and mounts the same api/*.js handlers (unchanged —
// they're plain (req,res) handlers using req.method/req.query/req.body and
// res.status().json(), which Express satisfies natively) as routes.
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import analyze from "./api/analyze.js";
import derivOrder from "./api/deriv-order.js";
import expState from "./api/exp-state.js";
import expTrades from "./api/exp-trades.js";
import forex from "./api/forex.js";
import news from "./api/news.js";
import positions from "./api/positions.js";
import priceCandles from "./api/price-candles.js";
import symbolStrategy from "./api/symbol-strategy.js";
import trades from "./api/trades.js";
import { startExpEngine } from "./server-exp-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const routes = {
  "analyze": analyze,
  "deriv-order": derivOrder,
  "exp-state": expState,
  "exp-trades": expTrades,
  "forex": forex,
  "news": news,
  "positions": positions,
  "price-candles": priceCandles,
  "symbol-strategy": symbolStrategy,
  "trades": trades,
};
for (const [name, handler] of Object.entries(routes)) {
  app.all(`/api/${name}`, (req, res) => handler(req, res));
}

const distDir = path.join(__dirname, "dist");
app.use(express.static(distDir));
// SPA fallback — anything not /api/* and not a static file serves index.html.
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, "index.html")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`listening on :${port}`));

// Runs the Experimento XAU/USD pyramid 24/7 regardless of any browser tab
// (see server-exp-engine.mjs) — requires min_machines_running=1 in
// fly.toml, otherwise Fly suspends the machine on idle HTTP traffic and
// this loop freezes right along with it.
startExpEngine();
