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
import forex from "./api/forex.js";
import news from "./api/news.js";
import positions from "./api/positions.js";
import symbolStrategy from "./api/symbol-strategy.js";
import trades from "./api/trades.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const routes = {
  "analyze": analyze,
  "deriv-order": derivOrder,
  "forex": forex,
  "news": news,
  "positions": positions,
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
