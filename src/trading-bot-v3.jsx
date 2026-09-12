import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, LineStyle, CrosshairMode } from "lightweight-charts";
import { T, STYLES } from "./theme.js";
import { SYMBOL_STRATEGY, scaledTpSl } from "./lib/symbolStrategy.js";
import { MAX_POSITIONS, MAX_TOTAL_POSITIONS, DEFAULT_STAKE, DEFAULT_MULTIPLIER, ANALYSIS_INTERVAL_MS, TRAIL_BREAKEVEN_AT, TRAIL_GIVEBACK } from "./lib/constants.js";
import Sparkline from "./components/Sparkline.jsx";
import TierBadge from "./components/TierBadge.jsx";
import TechnicalPanel from "./components/TechnicalPanel.jsx";
import CapitalPanel from "./components/CapitalPanel.jsx";
import SchedulePanel from "./components/SchedulePanel.jsx";
import RangeBar from "./components/RangeBar.jsx";
import TierLegend from "./components/TierLegend.jsx";
import SignalDistribution from "./components/SignalDistribution.jsx";

/* ─── ASSETS CONFIG ─────────────────────────────────────────────────────── */
const ASSETS = {
  // ── Crypto
  "ETH/USDT": { label:"ETH/USDT", type:"crypto", binance:"ETHUSDT", precision:2, basePrice:3000,  correlations:{} },
  "BTC/USDT": { label:"BTC/USDT", type:"crypto", binance:"BTCUSDT", precision:2, basePrice:65000, correlations:{} },
  "SOL/USDT": { label:"SOL/USDT", type:"crypto", binance:"SOLUSDT", precision:3, basePrice:150,   correlations:{} },
  // ── Forex (+1 = same direction, -1 = opposite direction)
  // USD-positive pairs go DOWN when USD weakens; USD-negative pairs go UP when USD weakens
  "EUR/USD":  { label:"EUR/USD",  type:"forex", binance:null, forexFrom:"EUR", forexTo:"USD", precision:5, basePrice:1.0823,
    correlations:{"GBP/USD":+1,"AUD/USD":+1,"NZD/USD":+1,"EUR/GBP":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1} },
  "GBP/USD":  { label:"GBP/USD",  type:"forex", binance:null, forexFrom:"GBP", forexTo:"USD", precision:5, basePrice:1.2700,
    correlations:{"EUR/USD":+1,"AUD/USD":+1,"NZD/USD":+1,"EUR/GBP":-1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1} },
  "USD/JPY":  { label:"USD/JPY",  type:"forex", binance:null, forexFrom:"USD", forexTo:"JPY", precision:3, basePrice:155.0,
    correlations:{"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/CHF":+1,"USD/CAD":+1} },
  "AUD/USD":  { label:"AUD/USD",  type:"forex", binance:null, forexFrom:"AUD", forexTo:"USD", precision:5, basePrice:0.6400,
    correlations:{"EUR/USD":+1,"GBP/USD":+1,"NZD/USD":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1} },
  "NZD/USD":  { label:"NZD/USD",  type:"forex", binance:null, forexFrom:"NZD", forexTo:"USD", precision:5, basePrice:0.6050,
    correlations:{"EUR/USD":+1,"GBP/USD":+1,"AUD/USD":+1,"USD/CHF":-1,"USD/JPY":-1,"USD/CAD":-1} },
  "USD/CHF":  { label:"USD/CHF",  type:"forex", binance:null, forexFrom:"USD", forexTo:"CHF", precision:5, basePrice:0.8950,
    correlations:{"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/JPY":+1,"USD/CAD":+1} },
  "USD/CAD":  { label:"USD/CAD",  type:"forex", binance:null, forexFrom:"USD", forexTo:"CAD", precision:5, basePrice:1.3600,
    correlations:{"EUR/USD":-1,"GBP/USD":-1,"AUD/USD":-1,"NZD/USD":-1,"USD/JPY":+1,"USD/CHF":+1} },
  "EUR/GBP":  { label:"EUR/GBP",  type:"forex", binance:null, forexFrom:"EUR", forexTo:"GBP", precision:5, basePrice:0.8450,
    correlations:{"EUR/USD":+1,"GBP/USD":-1,"USD/CHF":-1} },
  // ── Commodities (via Deriv WebSocket; Yahoo Finance fallback for watchlist)
  "XAU/USD":  { label:"ORO",       type:"commodity", binance:null, forexFrom:"XAU", forexTo:"USD", precision:2, basePrice:2700,
    yahooTicker:"GC=F",  correlations:{} },
  "XAG/USD":  { label:"PLATA",     type:"commodity", binance:null, forexFrom:"XAG", forexTo:"USD", precision:3, basePrice:32,
    yahooTicker:"SI=F",  correlations:{} },
  "XTI/USD":  { label:"PETRÓLEO",  type:"commodity", binance:null, forexFrom:"XTI", forexTo:"USD", precision:2, basePrice:80,
    yahooTicker:"CL=F",  correlations:{} },
};

// SYMBOL_STRATEGY / scaledTpSl now live in ./lib/symbolStrategy.js (imported
// above) so both the app and backtest tooling can reference the same shape —
// see that file for the tier methodology and re-validation instructions.

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
// Moved to ./lib/constants.js (imported above) so components like
// CapitalPanel can reference DEFAULT_STAKE without importing this whole file.

// Deriv WebSocket symbol mapping
const DERIV_SYMBOLS = {
  "EUR/USD":"frxEURUSD","GBP/USD":"frxGBPUSD","USD/JPY":"frxUSDJPY",
  "AUD/USD":"frxAUDUSD","NZD/USD":"frxNZDUSD","USD/CHF":"frxUSDCHF",
  "USD/CAD":"frxUSDCAD","EUR/GBP":"frxEURGBP",
  // Commodities — Gold and Silver have valid frx symbols on Deriv; Oil uses Yahoo Finance polling
  "XAU/USD":"frxXAUUSD","XAG/USD":"frxXAGUSD",
  // XTI/USD intentionally omitted — XTIUSD is not available on the public Deriv WS; uses Yahoo Finance
};

/* ─── UTILS ─────────────────────────────────────────────────────────────── */
const fP   = (n, p) => Number(n).toFixed(p);
const fUSD = (n, sign=true) => {
  const abs=Math.abs(n);
  const dec=abs<0.01?4:abs<0.10?3:2;
  // Was only ever prepending "+" for positives and NOTHING for negatives —
  // a loss of -$0.0025 rendered as literally "$0.0025", indistinguishable
  // from a gain by its text, relying purely on color to tell them apart.
  const prefix=n<0?"-":(sign&&n>=0?"+":"");
  return prefix+`$${abs.toFixed(dec)}`;
};
const fPct = n => (n>=0?"+":"")+n.toFixed(3)+"%";
const now  = () => new Date().toLocaleTimeString("es");

// Deriv multiplier P&L: stake × multiplier × (Δprice / entry)
function posPnL(pos, price, stake=DEFAULT_STAKE){
  const dir  = pos.type==="BUY" ? 1 : -1;
  const mult = pos.multiplier || DEFAULT_MULTIPLIER;
  return dir * (price - pos.entry) / pos.entry * stake * mult;
}

// Dynamic stop level for a position given its best-ever unrealized profit
// (peakPnl). Below the breakeven trigger it's just the original fixed stop
// (-slTarget). Once peakPnl crosses TRAIL_BREAKEVEN_AT×tpTarget, the floor
// rises to breakeven and then trails the peak, so a reversal from here closes
// at $0 or better instead of giving the whole move back. Same formula for
// BUY and SELL since peakPnl/tpTarget/slTarget are already direction-agnostic
// dollar amounts (posPnL folds the BUY/SELL sign in upstream).
function trailingStopLevel(peakPnl, tpTarget, slTarget){
  if(peakPnl>=tpTarget*TRAIL_BREAKEVEN_AT){
    return Math.max(0, peakPnl*(1-TRAIL_GIVEBACK));
  }
  return -slTarget;
}

// Standard forex week: opens Sunday 22:00 UTC, closes Friday 22:00 UTC.
// Deriv's commodities (Gold/Silver/Oil) follow essentially the same weekend
// closure, so they use this too. Crypto never closes — callers should check
// asset type first and skip this entirely for crypto.
function isForexMarketOpen(date=new Date()){
  const day=date.getUTCDay();   // 0=Sun ... 6=Sat
  const hour=date.getUTCHours();
  if(day===6) return false;             // all Saturday: closed
  if(day===0 && hour<22) return false;  // Sunday before 22:00 UTC: closed
  if(day===5 && hour>=22) return false; // Friday from 22:00 UTC: closed
  return true;
}
function isMarketOpen(assetType){
  if(assetType==="crypto") return true;
  return isForexMarketOpen();
}

function genCandles(base=1.0823, n=200, interval="5m"){
  const arr=[]; let p=base;
  // Scale volatility by timeframe multiplier and price magnitude
  const tfMult = {"1m":1,"5m":5,"15m":15,"1h":60,"4h":240}[interval]||5;
  const vol = base > 100 ? base*0.0003*Math.sqrt(tfMult) : 0.0001*Math.sqrt(tfMult);
  const nowSec = Math.floor(Date.now()/1000);
  for(let i=0;i<n;i++){
    const d=(Math.random()-.496)*vol;
    const o=p, c=p+d;
    arr.push({
      time: nowSec - (n-i)*60,
      o, c,
      h:Math.max(o,c)+Math.random()*vol*.2,
      l:Math.min(o,c)-Math.random()*vol*.2,
      v: Math.random()*1000+200,
    });
    p=c;
  }
  return arr;
}

function calcRSI(closes,p=14){
  if(closes.length<p+1)return 50;
  let g=0,l=0;
  for(let i=closes.length-p;i<closes.length;i++){const d=closes[i]-closes[i-1];d>0?g+=d:l-=d;}
  return 100-100/(1+g/(l||.0001));
}
function calcEMA(arr,p){const k=2/(p+1);let e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e;}
function calcMACD(closes){
  if(closes.length<26)return{macd:0,signal:0,hist:0};
  // Run EMA12 and EMA26 over the full history so they diverge properly
  let e12=closes[0],e26=closes[0];
  const k12=2/13,k26=2/27,k9=2/10;
  let sig=0,sigInit=false;
  for(let i=1;i<closes.length;i++){
    e12=closes[i]*k12+e12*(1-k12);
    e26=closes[i]*k26+e26*(1-k26);
    if(i>=25){
      const mv=e12-e26;
      if(!sigInit){sig=mv;sigInit=true;}
      else sig=mv*k9+sig*(1-k9);
    }
  }
  const macd=e12-e26;
  return{macd,signal:sig,hist:macd-sig};
}
function calcBB(closes,p=20){
  const sl=closes.slice(-p);
  const mean=sl.reduce((a,b)=>a+b,0)/sl.length;
  const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/sl.length);
  return{upper:mean+2*std,mid:mean,lower:mean-2*std};
}
/* ─── SUPPORT & RESISTANCE ──────────────────────────────────────────────── */
function calcSR(candles, tol=0.004){
  if(candles.length<20) return {supports:[], resistances:[]};
  const recent=candles.slice(-600);
  const currentPrice=recent.at(-1).c;
  const levels=[];

  // Collect pivot highs and lows
  for(let i=3; i<recent.length-3; i++){
    let isH=true, isL=true;
    for(let j=i-3; j<=i+3; j++){
      if(j===i) continue;
      if(recent[j].h>=recent[i].h) isH=false;
      if(recent[j].l<=recent[i].l) isL=false;
    }
    if(isH) levels.push({price:recent[i].h, type:"resistance", idx:i});
    if(isL) levels.push({price:recent[i].l, type:"support",    idx:i});
  }

  // Cluster nearby levels (within tol%)
  const clusters=[];
  for(const lv of levels){
    const existing=clusters.find(c=>Math.abs(c.price-lv.price)/c.price < tol);
    if(existing){
      existing.touches++;
      existing.price=(existing.price*existing.touches+lv.price)/(existing.touches+1);
    } else {
      clusters.push({price:lv.price, type:lv.type, touches:1});
    }
  }

  const strong=clusters.filter(c=>c.touches>=2);
  const supports=strong.filter(c=>c.price<currentPrice*0.9998)
    .sort((a,b)=>b.price-a.price).slice(0,4); // closest above bottom
  const resistances=strong.filter(c=>c.price>currentPrice*1.0002)
    .sort((a,b)=>a.price-b.price).slice(0,4); // closest above top

  return{supports, resistances, all:strong};
}

/* ─── CANDLE PATTERNS (Price Action) ────────────────────────────────────── */
function detectCandlePatterns(candles){
  if(candles.length<3) return [];
  const results=[];
  const c=candles.at(-1);   // last candle
  const p=candles.at(-2);   // previous candle
  const p2=candles.at(-3);  // two back

  const body=Math.abs(c.c-c.o);
  const range=c.h-c.l||0.00001;
  const upperWick=c.h-Math.max(c.c,c.o);
  const lowerWick=Math.min(c.c,c.o)-c.l;
  const prevBody=Math.abs(p.c-p.o);

  // Doji — body < 10% of range
  if(body<range*0.1 && range>0)
    results.push({name:"Doji", signal:"NEUTRAL", type:"REVERSAL", conf:55, emoji:"十",
      desc:"Apertura ≈ Cierre → indecisión total del mercado. Señal de posible cambio de dirección."});

  // Hammer (alcista) — mecha inferior larga en zona baja
  if(lowerWick>body*2 && upperWick<body*0.5 && body>0)
    results.push({name:"Hammer", signal:"BULLISH", type:"REVERSAL", conf:72, emoji:"🔨",
      desc:"Mecha inferior larga → precio rechazó fuertemente la baja. Señal de compra en soporte."});

  // Shooting Star (bajista) — mecha superior larga en zona alta
  if(upperWick>body*2 && lowerWick<body*0.5 && body>0)
    results.push({name:"Shooting Star", signal:"BEARISH", type:"REVERSAL", conf:72, emoji:"💫",
      desc:"Mecha superior larga → precio rechazó fuertemente el alza. Señal de venta en resistencia."});

  // Bullish Engulfing — vela verde envuelve vela roja anterior
  if(p.c<p.o && c.c>c.o && c.o<=p.c && c.c>=p.o && body>prevBody*0.9)
    results.push({name:"Bullish Engulfing", signal:"BULLISH", type:"REVERSAL", conf:76, emoji:"⬆",
      desc:"Vela verde envuelve completamente la vela roja anterior → fuerte presión compradora."});

  // Bearish Engulfing — vela roja envuelve vela verde anterior
  if(p.c>p.o && c.c<c.o && c.o>=p.c && c.c<=p.o && body>prevBody*0.9)
    results.push({name:"Bearish Engulfing", signal:"BEARISH", type:"REVERSAL", conf:76, emoji:"⬇",
      desc:"Vela roja envuelve completamente la vela verde anterior → fuerte presión vendedora."});

  // Morning Star (3 velas — alcista)
  if(p2.c<p2.o && Math.abs(p.c-p.o)<Math.abs(p2.c-p2.o)*0.3 && c.c>c.o && c.c>p2.o)
    results.push({name:"Morning Star", signal:"BULLISH", type:"REVERSAL", conf:74, emoji:"🌅",
      desc:"Patrón de 3 velas: bajista → indecisión → alcista. Señal de suelo y cambio de tendencia."});

  // Evening Star (3 velas — bajista)
  if(p2.c>p2.o && Math.abs(p.c-p.o)<Math.abs(p2.c-p2.o)*0.3 && c.c<c.o && c.c<p2.o)
    results.push({name:"Evening Star", signal:"BEARISH", type:"REVERSAL", conf:74, emoji:"🌆",
      desc:"Patrón de 3 velas: alcista → indecisión → bajista. Señal de techo y cambio de tendencia."});

  return results;
}

// ── Background-symbol pattern/S-R support: the multi-asset scanner only
// ever polls a raw price (no OHLC candles) for symbols you aren't actively
// charting, so detectCandlePatterns()/calcSR() have nothing to work with
// there. Bucket the rolling price history into coarse OHLC groups — not a
// substitute for real candles, but enough signal for the same pattern/S-R
// logic that already gates the active symbol to also inform symbols you
// aren't looking at, instead of those relying on EMA+RSI alone.
function buildPseudoCandles(closes, groupSize=3){
  const candles=[];
  for(let i=0;i+groupSize<=closes.length;i+=groupSize){
    const chunk=closes.slice(i,i+groupSize);
    candles.push({o:chunk[0], c:chunk[chunk.length-1], h:Math.max(...chunk), l:Math.min(...chunk)});
  }
  return candles;
}

/* ─── LEARNING STATS (localStorage) ─────────────────────────────────────── */
const LS_TRADES = "bot_trades_v2";
const LS_BALANCE= "bot_balance_v2";

function saveTradeLearning(trade){
  try{
    const arr=JSON.parse(localStorage.getItem(LS_TRADES)||"[]");
    arr.unshift(trade);
    localStorage.setItem(LS_TRADES, JSON.stringify(arr.slice(0,500)));
  }catch{}
}
function loadTrades(){ try{return JSON.parse(localStorage.getItem(LS_TRADES)||"[]");}catch{return [];} }

// ── Per-symbol dynamic confidence: same idea as the global recent-20 win
// rate threshold, but scoped to one symbol's own history instead of every
// symbol's blended together — ETH/USDT's threshold now reacts to ETH/USDT's
// own recent record, not diluted by how forex has been doing.
function getSymbolMinConf(trades, symbol, fallback){
  const symTrades=trades.filter(t=>t.symbol===symbol);
  if(symTrades.length<8) return fallback; // too little symbol-specific data yet — use the global figure
  const recent=symTrades.slice(0,20);
  const recentWR=recent.filter(t=>t.pnl>0).length/recent.length;
  if(recentWR<0.35)      return 73;
  if(recentWR<0.45)      return 68;
  if(recentWR<0.55)      return 64;
  if(recentWR>=0.65)     return 60;
  return fallback;
}

// ── Pattern feedback: byPattern (from calcLearningStats) already tracks each
// pattern's historical win rate — this is the first place that actually acts
// on it instead of just displaying it. Requires a decent sample (t>=5) before
// trusting a pattern's win rate enough to move confidence.
function getPatternAdjustment(patternNames, byPatternStats){
  if(!patternNames?.length || !byPatternStats?.length) return {delta:0, note:null};
  const matches=byPatternStats.filter(p=>patternNames.includes(p.name) && p.t>=5);
  if(!matches.length) return {delta:0, note:null};
  const avgWr=matches.reduce((s,p)=>s+p.wr,0)/matches.length;
  if(avgWr>=65) return {delta:6, note:`patrón históricamente fuerte (${Math.round(avgWr)}% WR)`};
  if(avgWr<=35) return {delta:-10, note:`patrón históricamente débil (${Math.round(avgWr)}% WR)`};
  return {delta:0, note:null};
}

// Mirrors a position into open_positions (see api/positions.js) so it isn't
// silently forgotten if the browser reloads or the dashboard is opened from
// another device while it's still open. Fire-and-forget — never blocks or
// throws into the caller.
function savePositionOpen(pos, confidence){
  fetch("/api/positions",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      clientId:pos.id, symbol:pos.symbol, type:pos.type, entryPrice:pos.entry,
      allocatedSize:pos.allocatedSize, multiplier:pos.multiplier, confidence,
      tp:pos.tp, sl:pos.sl,
    }),
  }).catch(()=>{});
}
function deletePositionOpen(clientId){
  fetch(`/api/positions?clientId=${encodeURIComponent(clientId)}`,{method:"DELETE"}).catch(()=>{});
}
function saveBalance(b){ try{localStorage.setItem(LS_BALANCE,String(b));}catch{} }
// Default matches bot_initial_capital (real starting capital) instead of an
// arbitrary $10,000 paper balance, so the stake ladder's % growth is measured
// against the capital you actually said you're starting with.
function loadBalance(){
  try{
    const v=localStorage.getItem(LS_BALANCE);
    if(v) return parseFloat(v);
    return parseFloat(localStorage.getItem("bot_initial_capital")||"200");
  }catch{return 200;}
}

function calcLearningStats(trades){
  if(!trades.length) return null;
  const byPattern={}, byDir={BUY:{w:0,t:0},SELL:{w:0,t:0}};
  let streak=0, maxStreak=0, curStreak=0;
  for(const t of trades){
    const win=t.pnl>0;
    // Direction stats
    if(byDir[t.type]){byDir[t.type].t++; if(win)byDir[t.type].w++;}
    // Pattern stats
    for(const pat of (t.activePatterns||[])){
      if(!byPattern[pat])byPattern[pat]={w:0,t:0};
      byPattern[pat].t++;
      if(win)byPattern[pat].w++;
    }
    // Streak
    if(win){curStreak++;maxStreak=Math.max(maxStreak,curStreak);}
    else curStreak=0;
  }
  // Recommend min confidence based on recent 20 trades
  const recent=trades.slice(0,20);
  const recentWR=recent.length?recent.filter(t=>t.pnl>0).length/recent.length:0.5;
  const suggestedConf=recentWR>0.6?60:recentWR>0.4?70:75;

  const sortedPat=Object.entries(byPattern)
    .map(([name,{w,t}])=>({name,wr:t>1?Math.round(w/t*100):0,t}))
    .filter(p=>p.t>=2)
    .sort((a,b)=>b.wr-a.wr);

  return{
    total:trades.length,
    wins:trades.filter(t=>t.pnl>0).length,
    wr:Math.round(trades.filter(t=>t.pnl>0).length/trades.length*100),
    recentWR:Math.round(recentWR*100),
    byDir,
    byPattern:sortedPat,
    maxStreak,
    suggestedConf,
    totalPnl:trades.reduce((s,t)=>s+t.pnl,0),
  };
}

/* ─── PATTERN DETECTION ─────────────────────────────────────────────────── */
function findPivots(candles, lb=3){
  const highs=[], lows=[];
  for(let i=lb; i<candles.length-lb; i++){
    let isH=true, isL=true;
    for(let j=i-lb; j<=i+lb; j++){
      if(j===i) continue;
      if(candles[j].h>=candles[i].h) isH=false;
      if(candles[j].l<=candles[i].l) isL=false;
    }
    if(isH) highs.push({idx:i, price:candles[i].h});
    if(isL) lows.push({idx:i,  price:candles[i].l});
  }
  return{highs,lows};
}

function detectPatterns(candles){
  if(candles.length<25) return [];
  const results=[];
  const recent=candles.slice(-120);
  const {highs,lows}=findPivots(recent,3);
  const tol=0.025; // 2.5% tolerancia para precios similares

  // ── Double Bottom (BULLISH REVERSAL)
  if(lows.length>=2){
    const [l1,l2]=lows.slice(-2);
    const diff=Math.abs(l1.price-l2.price)/l1.price;
    const gap=l2.idx-l1.idx;
    if(diff<tol && gap>=5 && gap<=45)
      results.push({name:"Double Bottom", signal:"BULLISH", type:"REVERSAL", conf:72, emoji:"W",
        desc:"Dos mínimos similares: el precio rebotó dos veces en soporte → probable subida."});
  }

  // ── Double Top (BEARISH REVERSAL)
  if(highs.length>=2){
    const [h1,h2]=highs.slice(-2);
    const diff=Math.abs(h1.price-h2.price)/h1.price;
    const gap=h2.idx-h1.idx;
    if(diff<tol && gap>=5 && gap<=45)
      results.push({name:"Double Top", signal:"BEARISH", type:"REVERSAL", conf:72, emoji:"M",
        desc:"Dos máximos similares: el precio rechazó la resistencia dos veces → probable bajada."});
  }

  // ── Head & Shoulders (BEARISH REVERSAL)
  if(highs.length>=3){
    const [h1,h2,h3]=highs.slice(-3);
    const shoulderDiff=Math.abs(h1.price-h3.price)/h1.price;
    if(shoulderDiff<tol && h2.price>h1.price*1.01 && h2.price>h3.price*1.01)
      results.push({name:"Head & Shoulders", signal:"BEARISH", type:"REVERSAL", conf:76, emoji:"∩",
        desc:"Tres picos: hombro-cabeza-hombro. El del medio es más alto → techo de mercado, señal bajista."});
  }

  // ── Inverse Head & Shoulders (BULLISH REVERSAL)
  if(lows.length>=3){
    const [l1,l2,l3]=lows.slice(-3);
    const shoulderDiff=Math.abs(l1.price-l3.price)/l1.price;
    if(shoulderDiff<tol && l2.price<l1.price*0.99 && l2.price<l3.price*0.99)
      results.push({name:"Inv. Head & Shoulders", signal:"BULLISH", type:"REVERSAL", conf:76, emoji:"∪",
        desc:"Tres valles: el del medio es más bajo → suelo de mercado, señal alcista clásica."});
  }

  // ── Ascending Triangle (BULLISH CONTINUATION)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(Math.abs(h1.price-h2.price)/h1.price<0.015 && l2.price>l1.price*1.005)
      results.push({name:"Ascending Triangle", signal:"BULLISH", type:"CONTINUATION", conf:68, emoji:"△",
        desc:"Resistencia plana + mínimos subiendo → acumulación compradora, ruptura alcista esperada."});
  }

  // ── Descending Triangle (BEARISH CONTINUATION)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(Math.abs(l1.price-l2.price)/l1.price<0.015 && h2.price<h1.price*0.995)
      results.push({name:"Descending Triangle", signal:"BEARISH", type:"CONTINUATION", conf:68, emoji:"▽",
        desc:"Soporte plano + máximos bajando → presión vendedora, ruptura bajista esperada."});
  }

  // ── Symmetrical Triangle (NEUTRAL → esperar ruptura)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(h2.price<h1.price*0.995 && l2.price>l1.price*1.005)
      results.push({name:"Symmetrical Triangle", signal:"NEUTRAL", type:"BILATERAL", conf:60, emoji:"◇",
        desc:"Máximos bajando y mínimos subiendo: precio comprimido → esperar ruptura en cualquier dirección."});
  }

  // ── Bullish Flag (BULLISH CONTINUATION)
  if(recent.length>=20){
    const pole=recent.slice(-20,-10), flag=recent.slice(-10);
    const poleChg=(pole.at(-1).c-pole[0].c)/pole[0].c;
    const flagChg=(flag.at(-1).c-flag[0].c)/flag[0].c;
    if(poleChg>0.015 && flagChg<0 && Math.abs(flagChg)<poleChg*0.5)
      results.push({name:"Bullish Flag", signal:"BULLISH", type:"CONTINUATION", conf:70, emoji:"⚑",
        desc:"Fuerte subida (asta) + pequeña corrección bajista → pausa antes de continuar al alza."});
    if(poleChg<-0.015 && flagChg>0 && Math.abs(flagChg)<Math.abs(poleChg)*0.5)
      results.push({name:"Bearish Flag", signal:"BEARISH", type:"CONTINUATION", conf:70, emoji:"⚐",
        desc:"Fuerte bajada (asta) + pequeño rebote → pausa antes de continuar a la baja."});
  }

  // ── Slope helper
  const slope=(p1,p2)=>(p2.price-p1.price)/(p2.idx-p1.idx||1);

  // ── Rising Wedge: ambas líneas suben, superior más empinada (BEARISH)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2), [l1,l2]=lows.slice(-2);
    const sH=slope(h1,h2), sL=slope(l1,l2);
    if(sH>0 && sL>0 && sH>sL*1.1)
      results.push({name:"Rising Wedge", signal:"BEARISH", type:"REVERSAL", conf:71, emoji:"↗⚠",
        desc:"Ambas líneas suben pero convergen: el impulso alcista se agota → probable caída."});
  }

  // ── Falling Wedge: ambas líneas bajan, superior más empinada (BULLISH)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2), [l1,l2]=lows.slice(-2);
    const sH=slope(h1,h2), sL=slope(l1,l2);
    if(sH<0 && sL<0 && Math.abs(sH)>Math.abs(sL)*1.1)
      results.push({name:"Falling Wedge", signal:"BULLISH", type:"REVERSAL", conf:71, emoji:"↘✓",
        desc:"Ambas líneas bajan pero convergen: la presión vendedora se agota → probable subida."});
  }

  // ── Rectangle: líneas paralelas y planas (oscilación entre soporte y resistencia)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2), [l1,l2]=lows.slice(-2);
    const sH=slope(h1,h2), sL=slope(l1,l2);
    const bothFlat=Math.abs(sH)<0.0005 && Math.abs(sL)<0.0005;
    const parallel=Math.abs(sH-sL)<0.0003;
    if(bothFlat && parallel){
      const prevChg=(recent.at(-1).c-recent[0].c)/recent[0].c;
      if(prevChg>0.01)
        results.push({name:"Bullish Rectangle", signal:"BULLISH", type:"CONTINUATION", conf:65, emoji:"▬↑",
          desc:"Precio oscila entre soporte y resistencia planos en tendencia alcista → ruptura al alza."});
      else if(prevChg<-0.01)
        results.push({name:"Bearish Rectangle", signal:"BEARISH", type:"CONTINUATION", conf:65, emoji:"▬↓",
          desc:"Precio oscila entre soporte y resistencia planos en tendencia bajista → ruptura a la baja."});
    }
  }

  // ── Pennant: triángulo simétrico tras movimiento fuerte (highs bajan, lows suben)
  if(highs.length>=2 && lows.length>=2 && recent.length>=20){
    const [h1,h2]=highs.slice(-2), [l1,l2]=lows.slice(-2);
    const sH=slope(h1,h2), sL=slope(l1,l2);
    const converging=sH<0 && sL>0 && Math.abs(Math.abs(sH)-Math.abs(sL))/Math.abs(sH)<0.5;
    if(converging){
      const pole=recent.slice(0,15);
      const poleChg=(pole.at(-1).c-pole[0].c)/pole[0].c;
      if(poleChg>0.012)
        results.push({name:"Bullish Pennant", signal:"BULLISH", type:"CONTINUATION", conf:69, emoji:"⊿↑",
          desc:"Fuerte movimiento alcista + triángulo simétrico → consolidación breve antes de continuar al alza."});
      else if(poleChg<-0.012)
        results.push({name:"Bearish Pennant", signal:"BEARISH", type:"CONTINUATION", conf:69, emoji:"⊿↓",
          desc:"Fuerte movimiento bajista + triángulo simétrico → consolidación breve antes de continuar a la baja."});
    }
  }

  return results;
}

function calcVolumeTrend(volumes){
  if(!volumes||volumes.length<2)return{current:0,avg:0,ratio:1};
  const avg=volumes.slice(-20).reduce((a,b)=>a+b,0)/Math.min(20,volumes.length);
  const current=volumes.at(-1)||0;
  return{current,avg,ratio:avg>0?current/avg:1};
}
function calcTrend1h(closes){
  if(closes.length<61)return 0;
  const ago=closes[closes.length-61];
  return(closes.at(-1)-ago)/ago*100;
}
// Short-term trend: % change over last N candles + bearish/bullish candle count
function calcShortTrend(candles, n=5){
  if(candles.length<n+1) return {pct:0, bearish:0, bullish:0, direction:"NEUTRAL"};
  const recent=candles.slice(-n);
  const bullish=recent.filter(c=>c.c>c.o).length;
  const bearish=recent.filter(c=>c.c<c.o).length;
  const pct=(recent.at(-1).c - recent[0].o) / recent[0].o * 100;
  const direction = pct > 0.05 ? "BULLISH" : pct < -0.05 ? "BEARISH" : "NEUTRAL";
  return{pct, bullish, bearish, direction};
}

/* ─── PROJECTION CALCULATOR ─────────────────────────────────────────────── */
function calcProjection(candles, aiResult, srLevels, tfInterval){
  if(!aiResult||aiResult.signal==="HOLD"||!candles?.length) return null;
  const last=candles.at(-1);
  const price=last.c;
  const isBuy=aiResult.signal==="BUY";
  const conf=Math.max(0.4,Math.min(0.99,(aiResult.confidence||60)/100));
  const tfSecs={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[tfInterval]||300;

  // ATR-like volatility from last 14 candles
  const recent=candles.slice(-14);
  const atr=recent.reduce((s,c)=>s+(c.h-c.l),0)/recent.length;

  // Target: nearest S/R in signal direction, fallback to ATR-based
  const nearTarget=isBuy
    ? srLevels?.resistances?.find(r=>r.price>price*1.0002)?.price
    : srLevels?.supports?.find(s=>s.price<price*0.9998)?.price;
  const targetPrice=nearTarget||(isBuy?price+atr*2.5*conf:price-atr*2.5*conf);
  const stopPrice  =isBuy?price-atr*1.5:price+atr*1.5;

  const priceDiff=targetPrice-price;
  const nCandles=Math.max(6,Math.min(25,Math.round(Math.abs(priceDiff/atr)*3)));

  const center=[],upper=[],lower=[];
  for(let i=0;i<=nCandles;i++){
    const t=last.time+i*tfSecs;
    const pct=i/nCandles;
    const eased=pct*pct*(3-2*pct); // smooth S-curve
    const proj=price+priceDiff*eased;
    const uncertainty=atr*(0.4+0.6*Math.sqrt(pct))*(1-conf*0.6);
    center.push({time:t,value:proj});
    upper.push({time:t,value:proj+(isBuy?uncertainty:uncertainty*0.5)});
    lower.push({time:t,value:proj-(isBuy?uncertainty*0.5:uncertainty)});
  }
  return{center,upper,lower,targetPrice,stopPrice,nCandles,atr,isBuy};
}

/* ─── LIGHTWEIGHT CHART ─────────────────────────────────────────────────── */
function LWChart({ candles, positions, trades, symbol, precision, srLevels, aiResult, tfInterval="5m", tpTarget=3, slTarget=2 }){
  const mainRef  = useRef(null);
  const rsiRef   = useRef(null);
  const macdRef  = useRef(null);
  const charts      = useRef({});
  const series      = useRef({});
  const posLines       = useRef([]);
  const srLines        = useRef([]);
  const projSeries     = useRef([]);
  const projPriceLines = useRef([]);
  const firstLoad   = useRef(true);
  const prevFitPrice= useRef(null);
  const prevCandlesLen = useRef(0);
  const [legend, setLegend] = useState(null);

  /* ── init charts ── */
  useEffect(()=>{
    if(!mainRef.current||!rsiRef.current||!macdRef.current) return;

    const base={
      layout:{ background:{color:"#04060f"}, textColor:"#4a6080" },
      grid:{ vertLines:{color:"#0d1a2d"}, horzLines:{color:"#0d1a2d"} },
      rightPriceScale:{ borderColor:"#152035" },
      handleScroll:true, handleScale:true,
    };

    // ── MAIN chart
    const main=createChart(mainRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#00b8e650",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#00b8e6"},
        horzLine:{color:"#00b8e650",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#00b8e6"},
      },
      timeScale:{ borderColor:"#152035", timeVisible:true, secondsVisible:false, fixLeftEdge:true, rightOffset:10, barSpacing:8 },
      rightPriceScale:{ borderColor:"#152035", minimumWidth:90 },
      watermark:{ visible:true, text:symbol, fontSize:40, color:"rgba(0,184,230,0.03)", horzAlign:"left", vertAlign:"top" },
    });

    const cs=main.addCandlestickSeries({
      upColor:"#00e676", downColor:"#ff1744",
      borderUpColor:"#00e676", borderDownColor:"#ff1744",
      wickUpColor:"#00e676cc", wickDownColor:"#ff1744cc",
      priceFormat:{ type:"price", precision, minMove:Math.pow(10,-precision) },
    });
    const vs=main.addHistogramSeries({
      priceFormat:{type:"volume"}, priceScaleId:"vol",
    });
    main.priceScale("vol").applyOptions({ scaleMargins:{top:0.82,bottom:0} });

    const e9s=main.addLineSeries({ color:"#00b8e6", lineWidth:1.5, title:"EMA9",  priceLineVisible:false, lastValueVisible:true,  crosshairMarkerVisible:false });
    const e21s=main.addLineSeries({ color:"#ffd600", lineWidth:1.5, title:"EMA21", priceLineVisible:false, lastValueVisible:true,  crosshairMarkerVisible:false });
    const e200s=main.addLineSeries({ color:"#ff6d00", lineWidth:2, lineStyle:LineStyle.Dashed, title:"EMA200", priceLineVisible:false, lastValueVisible:true, crosshairMarkerVisible:false });
    const bbu=main.addLineSeries({ color:"#00b8e635", lineWidth:1, lineStyle:LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    const bbm=main.addLineSeries({ color:"#344d7040", lineWidth:1, lineStyle:LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    const bbl=main.addLineSeries({ color:"#00b8e635", lineWidth:1, lineStyle:LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });

    // Crosshair legend
    main.subscribeCrosshairMove(p=>{
      const d=p?.seriesData?.get(cs);
      if(d) setLegend(d);
    });

    // ── RSI chart
    const rsiChart=createChart(rsiRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#00b8e630",width:1,style:LineStyle.Dashed,labelVisible:false},
        horzLine:{color:"#00b8e630",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#1a0533"},
      },
      timeScale:{ visible:false, borderColor:"#152035" },
      rightPriceScale:{ borderColor:"#152035", scaleMargins:{top:0.1,bottom:0.1} },
    });
    const rsiS=rsiChart.addLineSeries({ color:"#a855f7", lineWidth:1.5, title:"RSI", priceLineVisible:false, lastValueVisible:true });
    rsiS.createPriceLine({ price:70, color:"#ff174445", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:"OB 70" });
    rsiS.createPriceLine({ price:30, color:"#00e67645", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:"OS 30" });
    rsiS.createPriceLine({ price:50, color:"#344d7040", lineWidth:1, lineStyle:LineStyle.Dotted, axisLabelVisible:false });

    // ── MACD chart
    const macdChart=createChart(macdRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#00b8e630",width:1,style:LineStyle.Dashed,labelVisible:false},
        horzLine:{color:"#00b8e630",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#152035"},
      },
      timeScale:{ borderColor:"#152035", timeVisible:true, secondsVisible:false },
      rightPriceScale:{ borderColor:"#152035" },
    });
    const macdFmt={type:"price",precision:5,minMove:0.00001};
    const macdHist=macdChart.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false, title:"Hist", priceFormat:macdFmt });
    const macdLine=macdChart.addLineSeries({ color:"#00b8e6", lineWidth:1.5, title:"MACD", priceLineVisible:false, lastValueVisible:true, priceFormat:macdFmt });
    const macdSig =macdChart.addLineSeries({ color:"#ff6d00", lineWidth:1.5, title:"Signal", priceLineVisible:false, lastValueVisible:true, priceFormat:macdFmt });
    macdChart.addLineSeries({ color:"#344d7030", lineWidth:1, lineStyle:LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false }).setData([]);

    // ── Sync timescales
    let syncing=false;
    const syncRange=(src,targets)=>r=>{
      if(syncing||!r)return; syncing=true;
      targets.forEach(t=>t.timeScale().setVisibleLogicalRange(r));
      syncing=false;
    };
    main.timeScale().subscribeVisibleLogicalRangeChange(syncRange(main,[rsiChart,macdChart]));
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncRange(rsiChart,[main,macdChart]));
    macdChart.timeScale().subscribeVisibleLogicalRangeChange(syncRange(macdChart,[main,rsiChart]));

    // ── Resize observer
    const ro=new ResizeObserver(()=>{
      if(mainRef.current) main.applyOptions({width:mainRef.current.clientWidth});
      if(rsiRef.current)  rsiChart.applyOptions({width:rsiRef.current.clientWidth});
      if(macdRef.current) macdChart.applyOptions({width:macdRef.current.clientWidth});
    });
    ro.observe(mainRef.current);

    charts.current={main,rsiChart,macdChart};
    series.current={cs,vs,e9s,e21s,e200s,bbu,bbm,bbl,rsiS,macdHist,macdLine,macdSig};

    return()=>{
      ro.disconnect();
      posLines.current=[];
      srLines.current=[];
      projSeries.current=[];
      projPriceLines.current=[];
      series.current={};
      charts.current={};
      firstLoad.current=true;
      prevFitPrice.current=null;
      main.remove(); rsiChart.remove(); macdChart.remove();
    };
  },[symbol]);

  /* ── update data when candles change ── */
  useEffect(()=>{
    const {cs,vs,e9s,e21s,e200s,bbu,bbm,bbl,rsiS,macdHist,macdLine,macdSig}=series.current;
    if(!cs||!candles.length) return;

    // Deduplicate+sort to prevent Lightweight Charts assertion errors with Yahoo Finance data
    const clean=candles
      .filter(c=>c.time&&c.o!=null&&c.h!=null&&c.l!=null&&c.c!=null)
      .sort((a,b)=>a.time-b.time)
      .filter((c,i,arr)=>i===0||c.time!==arr[i-1].time);
    if(!clean.length) return;

    const closes=clean.map(c=>c.c);
    const times =clean.map(c=>c.time);
    const last=clean[clean.length-1];

    // Detect live tick vs bulk load — use fast update() path when only last bar changed
    const isTick=prevCandlesLen.current>50&&(clean.length===prevCandlesLen.current||clean.length===prevCandlesLen.current+1);
    prevCandlesLen.current=clean.length;

    if(isTick){
      // ── Fast path: only update last bar — preserves scroll position and shows tick animation
      try{
        cs.update({time:last.time,open:last.o,high:last.h,low:last.l,close:last.c});
        vs.update({time:last.time,value:last.v||0,color:last.c>=last.o?"#00e67640":"#ff174440"});
        // Update last EMA9/21 point
        const k9=2/10,k21=2/22;
        let e9=closes[0],e21=closes[0];
        for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
        e9s.update({time:last.time,value:e9});
        e21s.update({time:last.time,value:e21});
        // Update last EMA200 point
        if(e200s&&closes.length>=200){
          let e200v=closes[0]; const k200=2/201;
          for(let i=1;i<closes.length;i++) e200v=closes[i]*k200+e200v*(1-k200);
          e200s.update({time:last.time,value:e200v});
        }
        // Update last BB point
        if(closes.length>=20){
          const sl=closes.slice(-20);
          const mean=sl.reduce((a,b)=>a+b,0)/20;
          const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/20);
          bbu.update({time:last.time,value:mean+2*std});
          bbm.update({time:last.time,value:mean});
          bbl.update({time:last.time,value:mean-2*std});
        }
        // Update last RSI point
        if(closes.length>=15){
          let g=0,l=0;
          const n=closes.length;
          for(let j=n-13;j<n;j++){const d=closes[j]-closes[j-1]; d>0?g+=d:l-=d;}
          rsiS.update({time:last.time,value:100-100/(1+g/(l||0.0001))});
        }
        // Update last MACD point
        if(closes.length>=27){
          let e12v=closes[0],e26v=closes[0];
          const k12=2/13,k26=2/27,kSig=2/10;
          let sigV=0,sigVInit=false;
          for(let i=1;i<closes.length;i++){
            e12v=closes[i]*k12+e12v*(1-k12);
            e26v=closes[i]*k26+e26v*(1-k26);
            if(i>=25){
              const mv=e12v-e26v;
              if(!sigVInit){sigV=mv;sigVInit=true;}
              else sigV=mv*kSig+sigV*(1-kSig);
              const hv=mv-sigV;
              if(i===closes.length-1){
                mlD_last=mv; msD_last=sigV; mhD_last=hv;
              }
            }
          }
          // declare before use
          var mlD_last,msD_last,mhD_last;
          if(mlD_last!==undefined){
            macdLine.update({time:last.time,value:mlD_last});
            macdSig.update({time:last.time,value:msD_last});
            macdHist.update({time:last.time,value:mhD_last,color:mhD_last>=0?"#00e67680":"#ff174480"});
          }
        }
      }catch{}
      return;
    }

    // ── Full setData path: initial load, symbol switch, timeframe change ──
    cs.setData(clean.map(c=>({time:c.time,open:c.o,high:c.h,low:c.l,close:c.c})));
    vs.setData(clean.map(c=>({time:c.time,value:c.v||0,color:c.c>=c.o?"#00e67640":"#ff174440"})));

    // EMA per candle
    const e9d=[],e21d=[];
    let e9=closes[0],e21=closes[0];
    const k9=2/10,k21=2/22;
    for(let i=0;i<closes.length;i++){
      e9=closes[i]*k9+e9*(1-k9);
      e21=closes[i]*k21+e21*(1-k21);
      e9d.push({time:times[i],value:e9});
      e21d.push({time:times[i],value:e21});
    }
    // EMA200 per candle
    const e200d=[];
    let e200v=closes[0]; const k200=2/201;
    for(let i=0;i<closes.length;i++){
      e200v=closes[i]*k200+e200v*(1-k200);
      if(i>=199) e200d.push({time:times[i],value:e200v});
    }
    e9s.setData(e9d); e21s.setData(e21d);
    if(e200s) e200s.setData(e200d);

    // Bollinger Bands per candle
    const bbU=[],bbM=[],bbL=[];
    for(let i=19;i<closes.length;i++){
      const sl=closes.slice(i-19,i+1);
      const mean=sl.reduce((a,b)=>a+b,0)/20;
      const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/20);
      bbU.push({time:times[i],value:mean+2*std});
      bbM.push({time:times[i],value:mean});
      bbL.push({time:times[i],value:mean-2*std});
    }
    bbu.setData(bbU); bbm.setData(bbM); bbl.setData(bbL);

    // RSI per candle (rolling 14)
    const rsiD=[];
    for(let i=14;i<closes.length;i++){
      let g=0,l=0;
      for(let j=i-13;j<=i;j++){const d=closes[j]-closes[j-1]; d>0?g+=d:l-=d;}
      rsiD.push({time:times[i],value:100-100/(1+g/(l||0.0001))});
    }
    rsiS.setData(rsiD);

    // MACD per candle — running EMA across all history so lines diverge properly
    const mhD=[],mlD=[],msD=[];
    let e12v=closes[0],e26v=closes[0];
    const k12=2/13,k26=2/27,kSig=2/10;
    let sigV=0,sigVInit=false;
    for(let i=1;i<closes.length;i++){
      e12v=closes[i]*k12+e12v*(1-k12);
      e26v=closes[i]*k26+e26v*(1-k26);
      if(i>=25){
        const mv=e12v-e26v;
        if(!sigVInit){sigV=mv;sigVInit=true;}
        else sigV=mv*kSig+sigV*(1-kSig);
        const hv=mv-sigV;
        mlD.push({time:times[i],value:mv});
        msD.push({time:times[i],value:sigV});
        mhD.push({time:times[i],value:hv,color:hv>=0?"#00e67680":"#ff174480"});
      }
    }
    macdHist.setData(mhD); macdLine.setData(mlD); macdSig.setData(msD);

    const latestPrice=closes.at(-1);
    const prev=prevFitPrice.current;
    // Refit on first load, symbol change, or when real data arrives at a significantly different price (genCandles→Yahoo)
    const bigJump=prev!==null&&Math.abs(latestPrice-prev)/prev>0.005;
    if(firstLoad.current||bigJump){
      charts.current.main?.timeScale().fitContent();
      firstLoad.current=false;
    }
    prevFitPrice.current=latestPrice;
  },[candles]);

  /* ── S/R level lines ── */
  useEffect(()=>{
    const {cs}=series.current;
    if(!cs||!srLevels) return;
    srLines.current.forEach(l=>{try{cs.removePriceLine(l);}catch{}});
    srLines.current=[];
    (srLevels.resistances||[]).forEach(r=>{
      srLines.current.push(cs.createPriceLine({
        price:r.price, color:"#ff174455", lineWidth:1,
        lineStyle:LineStyle.Dotted, axisLabelVisible:false,
        title:`R×${r.touches}`,
      }));
    });
    (srLevels.supports||[]).forEach(s=>{
      srLines.current.push(cs.createPriceLine({
        price:s.price, color:"#00e67655", lineWidth:1,
        lineStyle:LineStyle.Dotted, axisLabelVisible:false,
        title:`S×${s.touches}`,
      }));
    });
  },[srLevels]);

  /* ── AI projection lines ── */
  useEffect(()=>{
    const {main}=charts.current;
    const {cs}=series.current;
    if(!main) return;

    // Remove old projection series (line series on main chart)
    projSeries.current.forEach(s=>{try{main.removeSeries(s);}catch{}});
    projSeries.current=[];
    // Remove old projection price lines (cs.createPriceLine — must use removePriceLine)
    if(cs){
      projPriceLines.current.forEach(l=>{try{cs.removePriceLine(l);}catch{}});
    }
    projPriceLines.current=[];

    const proj=calcProjection(candles,aiResult,srLevels,tfInterval);
    if(!proj) return;

    const {center,upper,lower,targetPrice,stopPrice,isBuy}=proj;
    const col=isBuy?"#00e676":"#ff1744";
    const colFaint=isBuy?"#00e67628":"#ff174428";

    const centerS=main.addLineSeries({color:col,lineWidth:2,lineStyle:LineStyle.Dashed,
      priceLineVisible:false,lastValueVisible:true,title:isBuy?"▲ Target":"▼ Target"});
    centerS.setData(center);
    projSeries.current.push(centerS);

    const upperS=main.addLineSeries({color:colFaint,lineWidth:1,lineStyle:LineStyle.Dotted,
      priceLineVisible:false,lastValueVisible:false});
    upperS.setData(upper);
    projSeries.current.push(upperS);

    const lowerS=main.addLineSeries({color:colFaint,lineWidth:1,lineStyle:LineStyle.Dotted,
      priceLineVisible:false,lastValueVisible:false});
    lowerS.setData(lower);
    projSeries.current.push(lowerS);

    // Target/stop price lines tracked separately so removePriceLine works
    if(cs){
      projPriceLines.current.push(
        cs.createPriceLine({price:targetPrice,color:col,lineWidth:1,
          lineStyle:LineStyle.Dashed,axisLabelVisible:true,
          title:`🎯 Objetivo ${targetPrice.toFixed(precision)}`}),
        cs.createPriceLine({price:stopPrice,color:isBuy?"#ff1744":"#00e676",lineWidth:1,
          lineStyle:LineStyle.Dotted,axisLabelVisible:true,
          title:`🛑 Stop ${stopPrice.toFixed(precision)}`}),
      );
    }
  },[aiResult,candles,srLevels,tfInterval]);

  /* ── position lines (entry, TP, SL) ── */
  useEffect(()=>{
    const {cs}=series.current;
    if(!cs) return;
    posLines.current.forEach(l=>{try{cs.removePriceLine(l);}catch{}});
    posLines.current=[];

    positions.forEach(pos=>{
      const isBuy=pos.type==="BUY";
      const entryCol=isBuy?"#00e676":"#ff1744";
      posLines.current.push(
        cs.createPriceLine({price:pos.entry, color:entryCol, lineWidth:2, lineStyle:LineStyle.Solid, axisLabelVisible:true, title:`${pos.type} @ ${pos.entry}`}),
      );
    });
  },[positions]);

  /* ── trade markers — only for current symbol, placed at nearest candle ── */
  useEffect(()=>{
    const {cs}=series.current;
    if(!cs||!candles.length) return;
    // Filter to current symbol only
    const symTrades=trades.filter(t=>!t.symbol||t.symbol===symbol);
    if(!symTrades.length){ try{cs.setMarkers([]);}catch{} return; }
    const markers=symTrades.slice(0,20).map(t=>{
      const isBuy=t.type==="BUY";
      const isProfit=t.pnl>=0;
      // Find nearest candle time — use last candle as fallback
      const tradeTs=t.tradeTime||0;
      const nearest=tradeTs>0
        ? candles.reduce((best,c)=>Math.abs(c.time-tradeTs)<Math.abs(best.time-tradeTs)?c:best).time
        : candles.at(-1)?.time||0;
      return{
        time: nearest,
        position: isBuy?"belowBar":"aboveBar",
        color: isProfit?"#00e676":"#ff1744",
        shape: isBuy?"arrowUp":"arrowDown",
        text: `${t.reason} ${t.pnl>=0?"+":""}$${t.pnl?.toFixed(2)}`,
        size:1,
      };
    }).filter(m=>m.time>0)
      .sort((a,b)=>a.time-b.time); // LW Charts requires sorted markers
    try{ cs.setMarkers(markers); }catch{}
  },[trades,candles,symbol]);

  /* ── render ── */
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",position:"relative"}}>

      {/* OHLCV Legend */}
      <div style={{position:"absolute",top:8,left:12,zIndex:10,display:"flex",gap:14,fontSize:10,
        fontFamily:"IBM Plex Mono,monospace",pointerEvents:"none",background:"#04060fcc",padding:"4px 10px",borderRadius:4}}>
        <span style={{color:"#4a6080"}}>{symbol}</span>
        {legend&&<>
          <span>O <span style={{color:legend.open>=legend.close?"#ff1744":"#00e676"}}>{Number(legend.open).toFixed(precision)}</span></span>
          <span>H <span style={{color:"#00e676"}}>{Number(legend.high).toFixed(precision)}</span></span>
          <span>L <span style={{color:"#ff1744"}}>{Number(legend.low).toFixed(precision)}</span></span>
          <span>C <span style={{color:legend.close>=legend.open?"#00e676":"#ff1744",fontWeight:700}}>{Number(legend.close).toFixed(precision)}</span></span>
        </>}
        <span style={{color:"#00b8e6",marginLeft:8}}>── EMA9</span>
        <span style={{color:"#ffd600"}}>── EMA21</span>
        <span style={{color:"#00b8e640"}}>- - BB</span>
      </div>

      {/* Main chart (candles) */}
      <div ref={mainRef} style={{flex:4,minHeight:0}}/>

      {/* RSI label + chart */}
      <div style={{borderTop:"1px solid #0d1a2d",display:"flex",alignItems:"center",
        gap:10,padding:"2px 10px",background:"#04060f"}}>
        <span style={{fontSize:8,color:"#a855f7",letterSpacing:2,fontFamily:"IBM Plex Mono,monospace"}}>RSI 14</span>
        <span style={{fontSize:8,color:"#ff174460"}}>─ 70</span>
        <span style={{fontSize:8,color:"#00e67660"}}>─ 30</span>
      </div>
      <div ref={rsiRef} style={{flex:1,minHeight:0}}/>

      {/* MACD label + chart */}
      <div style={{borderTop:"1px solid #0d1a2d",display:"flex",alignItems:"center",
        gap:10,padding:"2px 10px",background:"#04060f"}}>
        <span style={{fontSize:8,color:"#00b8e6",letterSpacing:2,fontFamily:"IBM Plex Mono,monospace"}}>MACD</span>
        <span style={{fontSize:8,color:"#ff6d00"}}>── Signal</span>
        <span style={{fontSize:8,color:"#00e67660"}}>▌ Hist+</span>
        <span style={{fontSize:8,color:"#ff174460"}}>▌ Hist-</span>
      </div>
      <div ref={macdRef} style={{flex:1,minHeight:0}}/>
    </div>
  );
}

/* ─── POSITION ROW ───────────────────────────────────────────────────────── */
function PosRow({pos, price, precision, onClose, tpTarget=3, slTarget=2}){
  const ps=pos.allocatedSize||DEFAULT_STAKE;
  const pnl=posPnL(pos,price,ps);
  const col=pnl>=0?T.green:T.red;
  const pct=Math.min(100,Math.max(0,(pnl/tpTarget)*100));
  const pctChange=(price-pos.entry)/pos.entry*100;
  const isBuy=pos.type==="BUY";
  const dirCol=isBuy?T.green:T.red; // direction is fixed — never confuse this with the win/loss color (col)
  return(
    <div className="fade-up" style={{background:T.card,border:`1px solid ${col}30`,borderRadius:6,padding:"8px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,fontWeight:700,color:dirCol,background:`${dirCol}18`,padding:"2px 8px",borderRadius:4,letterSpacing:1}}>
            {isBuy?"▲ BUY":"▼ SELL"}
          </span>
          <span className="mono" style={{fontSize:10,color:T.muted}}>@ {fP(pos.entry,precision)}</span>
          <span className="mono" style={{fontSize:9,color:T.muted}}>×${ps.toFixed(2)}</span>
          <span className="mono" style={{fontSize:10,color:pctChange>=0?T.green:T.red}}>{fPct(pctChange)}</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span className="mono" style={{fontSize:14,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${T.muted}40`,color:T.muted,borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10}}>✕</button>
        </div>
      </div>
      <div style={{height:3,background:T.dim,borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:pnl>=0?T.green:T.red,borderRadius:2,transition:"width .4s ease"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
        <span style={{fontSize:8,color:T.red}}>SL -{fUSD(slTarget,false)}</span>
        {pos.derivContractId&&<span style={{fontSize:7,color:"#00b8e6",background:"#00b8e615",padding:"1px 5px",borderRadius:3}}>DERIV #{String(pos.derivContractId)}</span>}
        <span style={{fontSize:8,color:pnl>=0?T.green:T.muted}}>{pct.toFixed(0)}% → TP +{fUSD(tpTarget,false)}</span>
      </div>
    </div>
  );
}

/* ─── NEWS TICKER ────────────────────────────────────────────────────────── */
function Ticker({headlines}){
  if(!headlines.length)return null;
  const d=[...headlines,...headlines];
  const total=d.length*220;
  return(
    <div style={{overflow:"hidden",background:T.dim,borderRadius:6,padding:"5px 0",borderLeft:`2px solid ${T.accent}`}}>
      <div style={{display:"flex",gap:0,animation:`ticker ${total/60}s linear infinite`,whiteSpace:"nowrap",width:"max-content"}}>
        {d.map((h,i)=>(
          <span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"0 20px",fontSize:9,
            color:h.sentiment==="bullish"?T.green:h.sentiment==="bearish"?T.red:T.muted}}>
            <span style={{opacity:.5}}>◆</span>
            <span style={{color:h.impact==="ALTO"?T.orange:T.muted,fontSize:8,fontWeight:700}}>{h.impact}</span>
            {h.title}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── API CALLS ─────────────────────────────────────────────────────────── */
async function fetchNewsAI(symbol){
  const r=await fetch("/api/news",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol})});
  if(!r.ok)return{headlines:[],market_bias:"neutral",summary:"Sin noticias disponibles."};
  return r.json();
}

async function fetchForexRate(from="EUR",to="USD"){
  // 1) Try serverless proxy (works on Vercel production)
  try{
    const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from,to})});
    if(r.ok){
      const d=await r.json();
      if(typeof d.rate==="number") return d.rate;
    }
  }catch{}
  // 2) Direct fallback — open.er-api.com supports CORS, works in browser (local dev + prod)
  try{
    const r=await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const d=await r.json();
    if(d.result==="success"&&typeof d.rates?.[to]==="number") return d.rates[to];
  }catch{}
  return null;
}

// Module-level cache (shared across React re-renders)
const _fxCache={};
async function fetchForexRateCached(from,to,ttlMs=15000){
  const key=`${from}_${to}`;
  const now=Date.now();
  if(_fxCache[key]&&now-_fxCache[key].ts<ttlMs) return _fxCache[key].rate;
  const rate=await fetchForexRate(from,to);
  if(rate) _fxCache[key]={rate,ts:now};
  return rate||_fxCache[key]?.rate||null;
}

// Fetch commodity spot price via serverless proxy (Yahoo Finance GC=F / SI=F / CL=F)
async function fetchCommodityRate(yahooTicker){
  try{
    const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({yahooSym:yahooTicker})});
    if(r.ok){const d=await r.json();if(typeof d.rate==="number")return d.rate;}
  }catch{}
  return null;
}
async function fetchCommodityRateCached(yahooTicker,ttlMs=15000){
  const key=`_commodity_${yahooTicker}`;
  const now=Date.now();
  if(_fxCache[key]&&now-_fxCache[key].ts<ttlMs)return _fxCache[key].rate;
  const rate=await fetchCommodityRate(yahooTicker);
  if(rate)_fxCache[key]={rate,ts:now};
  return rate||_fxCache[key]?.rate||null;
}

// Fetch real 1-min candles for forex from Yahoo Finance (via serverless proxy)
async function fetchForexCandles(from,to,limit=500,interval="1m"){
  try{
    const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({from,to,candles:true,limit,interval})});
    if(!r.ok) return null;
    const d=await r.json();
    if(d.candles?.length>5) return d;
  }catch{}
  return null;
}

/* ─── DERIV HELPERS ──────────────────────────────────────────────────────── */
async function openDerivOrder(symbol,side,stake,multiplier,tpTarget,slTarget){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"open",symbol,side,stake,multiplier,tpTarget,slTarget})});
    const d=await r.json();
    if(!r.ok||d.error) return{ok:false,error:d.error||"Error Deriv"};
    return{ok:true,...d};
  }catch(e){return{ok:false,error:e.message};}
}

async function closeDerivOrder(contractId){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"close",contractId})});
    const d=await r.json();
    if(!r.ok||d.error) return{ok:false,error:d.error||"Error Deriv"};
    return{ok:true,...d};
  }catch(e){return{ok:false,error:e.message};}
}

async function getDerivBalance(){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"balance"})});
    const d=await r.json();
    return r.ok&&!d.error?d:null;
  }catch{return null;}
}

async function analyzeMarketAI({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,correlations,positions,balance,news,marketBias,newsSummary,reason,positionSize,tpTarget,slTarget,activePrediction}){
  const r=await fetch("/api/analyze",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,correlations,positions,balance,news,marketBias,newsSummary,reason,positionSize,tpTarget,slTarget,activePrediction}),
  });
  if(!r.ok){
    // 401/403 here means Groq rejected the API key itself — this is a config
    // problem in Vercel's env vars (GROQ_API_KEY), not a bug in this app.
    // Distinguish it from a generic network error so it's obvious to fix.
    const isAuthError=r.status===401||r.status===403;
    return{signal:"HOLD",confidence:40,
      reasoning:isAuthError
        ?"GROQ_API_KEY inválida o expirada — genera una nueva en console.groq.com y actualízala en Vercel (Settings → Environment Variables), luego redeploy."
        :`Error del servidor de análisis (HTTP ${r.status}).`,
      news_impact:"NEUTRAL",
      key_factor:isAuthError?"API key de Groq inválida":"Error conexión",
      risk:"ALTO",should_open:false};
  }
  return r.json();
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function TradingBot(){
  const [symbol,setSymbol]       = useState("ETH/USDT");
  const asset                    = ASSETS[symbol];

  const [candles,setCandles]     = useState(()=>genCandles(ASSETS["ETH/USDT"].basePrice,300));
  const [price,setPrice]         = useState(ASSETS["ETH/USDT"].basePrice);
  const [rsi,setRsi]             = useState(50);
  const [macd,setMacd]           = useState({macd:0,signal:0,hist:0});
  const [bb,setBB]               = useState(()=>calcBB(genCandles(ASSETS["ETH/USDT"].basePrice,300).map(c=>c.c)));
  const [ema9,setEma9]           = useState(0);
  const [ema21,setEma21]         = useState(0);
  const [volTrend,setVolTrend]   = useState({current:0,avg:0,ratio:1});
  const [trend1h,setTrend1h]     = useState(0);
  const [patterns,setPatterns]   = useState([]);
  const [positions,setPositions] = useState([]);
  const [balance,setBalance]     = useState(()=>loadBalance());
  // v2: default stake dropped from $10 to $0.05 for small-capital start (see
  // DEFAULT_STAKE); key bumped so existing users pick up the new default too.
  const [positionSize,setPositionSize] = useState(()=>parseFloat(localStorage.getItem("bot_stake_v2")||String(DEFAULT_STAKE)));
  // ── Capital ladder: step the stake up (or down) as the account grows
  // (or shrinks) by stakeGrowthTrigger%, so risk stays proportional to
  // capital instead of fixed at whatever you started with.
  const [stakeAutoScale,setStakeAutoScale]   = useState(()=>localStorage.getItem("bot_stake_autoscale")!=="false");
  const [stakeStep,setStakeStep]             = useState(()=>parseFloat(localStorage.getItem("bot_stake_step")||"0.05"));
  const [stakeGrowthTrigger,setStakeGrowthTrigger] = useState(()=>parseFloat(localStorage.getItem("bot_stake_trigger")||"0.20"));
  const [minStake,setMinStake]               = useState(()=>parseFloat(localStorage.getItem("bot_stake_min")||String(DEFAULT_STAKE)));
  const [ladderBaseline,setLadderBaseline]   = useState(()=>parseFloat(localStorage.getItem("bot_ladder_baseline")||String(loadBalance())));
  const [initialCapital,setInitialCapital]   = useState(()=>parseFloat(localStorage.getItem("bot_initial_capital")||"200"));
  const [trades,setTrades]       = useState([]);
  const [log,setLog]             = useState([]);
  const [news,setNews]           = useState([]);
  const [newsData,setNewsData]   = useState(null);
  const [aiResult,setAiResult]   = useState(null);
  const [activePrediction,setActivePrediction] = useState(null);
  const activePredRef = useRef(null);
  // Persisted so AUTO survives a page reload — previously it always started
  // OFF, meaning "autonomous" in name only if you had to re-arm it by hand
  // every time the tab reloaded.
  const [autoMode,setAutoMode]   = useState(()=>localStorage.getItem("bot_auto_mode")==="true");
  const [scheduledStart,setScheduledStart] = useState(null); // ms epoch, or null
  const [scheduleInput,setScheduleInput]   = useState("");   // <input type="datetime-local"> value
  const [scheduleRemainingMs,setScheduleRemainingMs] = useState(null);
  const [analyzing,setAnalyzing] = useState(false);
  const [loadingNews,setLoadingNews] = useState(false);
  const [autoPhase,setAutoPhase] = useState("idle");
  const [blockReason,setBlockReason] = useState("");
  const [dynamicMinConf,setDynamicMinConf] = useState(62);
  const [nextAnalysis,setNextAnalysis] = useState(null);
  const [closedCount,setClosedCount]       = useState(0);
  const [totalProfit,setTotalProfit]       = useState(0);
  const [consecutiveLosses,setConsLosses]  = useState(0);
  const [shortTrend,setShortTrend]         = useState({pct:0,bullish:0,bearish:0,direction:"NEUTRAL"});
  const [skipCycles,setSkipCycles]         = useState(0);
  const [ema200,setEma200]                 = useState(0);
  const [srLevels,setSrLevels]             = useState({supports:[],resistances:[],all:[]});
  const [learningStats,setLearningStats]   = useState(()=>calcLearningStats(loadTrades()));
  const [showLearning,setShowLearning]     = useState(false);
  const [chartInterval,setChartInterval]  = useState("1m");
  const [multiMonitor,setMultiMonitor]    = useState(false);
  const [assetSignals,setAssetSignals]    = useState({});
  const [forexLive,setForexLive]          = useState(false);
  const [priceVerified,setPriceVerified]  = useState(false);
  const [corrSignals,setCorrSignals]      = useState({});
  const [forexWatch,setForexWatch]        = useState({});
  const [commodityWatch,setCommodityWatch]= useState({});
  const [activeView,setActiveView]        = useState("dashboard");
  // v3: seeded from SYMBOL_STRATEGY (walk-forward-validated per-symbol TP/SL),
  // scaled to the initial stake/multiplier — see scaledTpSl() for why this
  // scaling matters (raw SYMBOL_STRATEGY values assume $10×100x).
  const initStake=parseFloat(localStorage.getItem("bot_stake_v2")||String(DEFAULT_STAKE));
  const initMult=parseInt(localStorage.getItem("bot_mult")||String(DEFAULT_MULTIPLIER),10);
  const initScaled=scaledTpSl("ETH/USDT",initStake,initMult);
  const initTp=initScaled?.tp||6.00, initSl=initScaled?.sl||3.00;
  const [tpTarget,setTpTarget]            = useState(()=>parseFloat(localStorage.getItem("bot_tp_v3")||String(initTp)));
  const [slTarget,setSlTarget]            = useState(()=>parseFloat(localStorage.getItem("bot_sl_v3")||String(initSl)));
  const tpTargetRef = useRef(parseFloat(localStorage.getItem("bot_tp_v3")||String(initTp)));
  const slTargetRef = useRef(parseFloat(localStorage.getItem("bot_sl_v3")||String(initSl)));
  const [derivEnabled,setDerivEnabled]    = useState(()=>localStorage.getItem("derivEnabled")==="true");
  const [derivBalance,setDerivBalance]    = useState(null);
  const [derivLoginId,setDerivLoginId]    = useState(null);
  const [derivConnectErr,setDerivConnectErr]= useState(null);
  const [derivTesting,setDerivTesting]    = useState(false);
  const [multiplier,setMultiplier]        = useState(()=>parseInt(localStorage.getItem("bot_mult")||"100"));
  const derivEnabledRef = useRef(localStorage.getItem("derivEnabled")==="true");
  const [livePrices,setLivePrices]        = useState({});
  const chartIntervalRef = useRef("1m");
  const bgPricesRef   = useRef({});
  const corrSignalsRef= useRef({});
  const assetSignalsRef= useRef({});
  const livePricesRef = useRef({});
  const newsCacheRef  = useRef({}); // {symbol: {data, ts}} — 30 min frontend cache
  const consLossesRef  = useRef(0);
  const shortTrendRef  = useRef({pct:0,bullish:0,bearish:0,direction:"NEUTRAL"});
  const skipCyclesRef  = useRef(0);
  const ema200Ref      = useRef(0);
  const srRef          = useRef({supports:[],resistances:[],all:[]});

  const posRef    = useRef([]);
  const priceRef  = useRef(ASSETS["ETH/USDT"].basePrice);
  const autoRef   = useRef(false);
  const rsiRef    = useRef(50);
  const macdRef   = useRef({macd:0,signal:0,hist:0});
  const bbRef     = useRef({upper:0,mid:0,lower:0});
  const ema9Ref    = useRef(0);
  const ema21Ref   = useRef(0);
  const volRef     = useRef({current:0,avg:0,ratio:1});
  const trend1hRef = useRef(0);
  const patternsRef= useRef([]);
  const newsRef   = useRef([]);
  const newsDataRef = useRef(null);
  const candlesRef = useRef([]);
  const balanceRef     = useRef(10000);
  const positionSizeRef= useRef(parseFloat(localStorage.getItem("bot_stake_v2")||String(DEFAULT_STAKE)));
  const multiplierRef  = useRef(parseInt(localStorage.getItem("bot_mult")||"100"));
  const timerRef  = useRef(null);
  const countRef  = useRef(null);
  const pendingAnalysisRef = useRef(false);
  const symbolRef = useRef("ETH/USDT");
  const stakeAutoScaleRef     = useRef(stakeAutoScale);
  const stakeStepRef          = useRef(stakeStep);
  const stakeGrowthTriggerRef = useRef(stakeGrowthTrigger);
  const minStakeRef           = useRef(minStake);
  const ladderBaselineRef     = useRef(ladderBaseline);

  useEffect(()=>{posRef.current=positions;},[positions]);
  useEffect(()=>{priceRef.current=price;},[price]);
  useEffect(()=>{autoRef.current=autoMode;localStorage.setItem("bot_auto_mode",String(autoMode));},[autoMode]);
  useEffect(()=>{rsiRef.current=rsi;},[rsi]);
  useEffect(()=>{macdRef.current=macd;},[macd]);
  useEffect(()=>{bbRef.current=bb;},[bb]);
  useEffect(()=>{ema9Ref.current=ema9;},[ema9]);
  useEffect(()=>{ema21Ref.current=ema21;},[ema21]);
  useEffect(()=>{volRef.current=volTrend;},[volTrend]);
  useEffect(()=>{trend1hRef.current=trend1h;},[trend1h]);
  useEffect(()=>{patternsRef.current=patterns;},[patterns]);
  useEffect(()=>{newsRef.current=news;},[news]);
  useEffect(()=>{newsDataRef.current=newsData;},[newsData]);
  useEffect(()=>{balanceRef.current=balance;},[balance]);
  useEffect(()=>{positionSizeRef.current=positionSize;localStorage.setItem("bot_stake_v2",String(positionSize));},[positionSize]);
  useEffect(()=>{multiplierRef.current=multiplier;localStorage.setItem("bot_mult",String(multiplier));},[multiplier]);
  useEffect(()=>{tpTargetRef.current=tpTarget;localStorage.setItem("bot_tp_v3",String(tpTarget));},[tpTarget]);
  useEffect(()=>{slTargetRef.current=slTarget;localStorage.setItem("bot_sl_v3",String(slTarget));},[slTarget]);
  useEffect(()=>{stakeAutoScaleRef.current=stakeAutoScale;localStorage.setItem("bot_stake_autoscale",String(stakeAutoScale));},[stakeAutoScale]);
  useEffect(()=>{stakeStepRef.current=stakeStep;localStorage.setItem("bot_stake_step",String(stakeStep));},[stakeStep]);
  useEffect(()=>{stakeGrowthTriggerRef.current=stakeGrowthTrigger;localStorage.setItem("bot_stake_trigger",String(stakeGrowthTrigger));},[stakeGrowthTrigger]);
  useEffect(()=>{minStakeRef.current=minStake;localStorage.setItem("bot_stake_min",String(minStake));},[minStake]);
  useEffect(()=>{ladderBaselineRef.current=ladderBaseline;localStorage.setItem("bot_ladder_baseline",String(ladderBaseline));},[ladderBaseline]);
  useEffect(()=>{localStorage.setItem("bot_initial_capital",String(initialCapital));},[initialCapital]);

  // ── Load learning history from Postgres on mount — this is what makes
  // "aprendizaje automático" persist across browsers/devices instead of only
  // this one browser's localStorage. localStorage's calcLearningStats(loadTrades())
  // above is the instant first paint; this replaces it once the shared,
  // durable history loads (falls back silently to the local-only view if the
  // DB is unreachable — see api/trades.js).
  useEffect(()=>{
    fetch("/api/trades?limit=500")
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.trades?.length){
          setLearningStats(calcLearningStats(d.trades));
          setTrades(d.trades); // seeds the Dashboard's "Historial" panel with real persisted data
        }
      })
      .catch(()=>{});
  },[]);

  // ── Restore open positions from Postgres on mount — otherwise a reload
  // while a position is open makes the app "forget" it entirely (it keeps
  // existing at the broker if derivEnabled, but nothing here would manage
  // its TP/SL/trailing-stop anymore). Only seeds if nothing is open locally
  // yet, so it never clobbers a position opened earlier in this session.
  useEffect(()=>{
    fetch("/api/positions")
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.positions?.length && posRef.current.length===0){
          setPositions(d.positions.map(p=>({...p,peakPnl:0})));
          addLog(`🔄 ${d.positions.length} posición(es) abierta(s) restaurada(s) desde la base de datos`,"info");
        }
      })
      .catch(()=>{});
  },[]);

  // ── Single source of truth for TP/SL: re-derive from SYMBOL_STRATEGY every
  // time the symbol, stake or multiplier changes, so the validated price-move
  // percentage is preserved whether you're at $0.05 or the ladder has bumped
  // you to $0.50. Symbols with no validated config keep whatever TP/SL the
  // user has set manually (untouched).
  useEffect(()=>{
    const scaled=scaledTpSl(symbol,positionSize,multiplier);
    if(scaled){
      setTpTarget(scaled.tp); tpTargetRef.current=scaled.tp;
      setSlTarget(scaled.sl); slTargetRef.current=scaled.sl;
    }
  },[symbol,positionSize,multiplier]);

  // ── Capital ladder: whenever the balance settles after a trade, check if
  // it crossed a ±stakeGrowthTrigger% band since the last adjustment and
  // step the stake up (protects gains by risking more only once they're
  // real) or down (protects capital when it's shrinking) accordingly.
  useEffect(()=>{
    if(!stakeAutoScale) return;
    const baseline=ladderBaselineRef.current;
    if(!baseline||baseline<=0) return;
    const growth=(balance-baseline)/baseline;
    if(growth>=stakeGrowthTrigger){
      const next=+(positionSizeRef.current+stakeStepRef.current).toFixed(2);
      setPositionSize(next);
      setLadderBaseline(balance);
      addLog(`📈 Capital +${(growth*100).toFixed(0)}% desde el último ajuste → stake sube a $${next.toFixed(2)}`,"buy");
    } else if(growth<=-stakeGrowthTrigger){
      const next=Math.max(minStakeRef.current,+(positionSizeRef.current-stakeStepRef.current).toFixed(2));
      if(next!==positionSizeRef.current){
        setPositionSize(next);
        setLadderBaseline(balance);
        addLog(`📉 Capital ${(growth*100).toFixed(0)}% desde el último ajuste → stake baja a $${next.toFixed(2)}`,"sell");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[balance,stakeAutoScale,stakeGrowthTrigger]);
  useEffect(()=>{derivEnabledRef.current=derivEnabled;localStorage.setItem("derivEnabled",String(derivEnabled));},[derivEnabled]);
  useEffect(()=>{symbolRef.current=symbol;},[symbol]);
  useEffect(()=>{consLossesRef.current=consecutiveLosses;},[consecutiveLosses]);
  useEffect(()=>{shortTrendRef.current=shortTrend;},[shortTrend]);
  useEffect(()=>{skipCyclesRef.current=skipCycles;},[skipCycles]);
  useEffect(()=>{ema200Ref.current=ema200;},[ema200]);
  useEffect(()=>{srRef.current=srLevels;},[srLevels]);
  useEffect(()=>{chartIntervalRef.current=chartInterval;},[chartInterval]);
  useEffect(()=>{corrSignalsRef.current=corrSignals;},[corrSignals]);
  useEffect(()=>{assetSignalsRef.current=assetSignals;},[assetSignals]);
  useEffect(()=>{ candlesRef.current=candles; },[candles]);
  // Keep livePrices in sync with the active symbol's real-time price
  useEffect(()=>{
    setLivePrices(p=>({...p,[symbol]:price}));
    livePricesRef.current[symbol]=price;
  },[symbol,price]);
  // Fetch prices for non-active symbols that have open positions
  useEffect(()=>{
    const others=[...new Set(positions.filter(p=>p.symbol&&p.symbol!==symbol).map(p=>p.symbol))];
    if(!others.length) return;
    const fetchOthers=async()=>{
      for(const sym of others){
        const cfg=ASSETS[sym];
        if(!cfg) continue;
        try{
          let p;
          if(cfg.type==="crypto"){
            const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binance}`);
            const d=await r.json();
            p=parseFloat(d.price);
          } else if(cfg.type==="commodity"){
            p=await fetchCommodityRateCached(cfg.yahooTicker,5000);
          } else {
            p=await fetchForexRateCached(cfg.forexFrom,cfg.forexTo,5000);
          }
          if(p&&!isNaN(p)){
            setLivePrices(prev=>({...prev,[sym]:p}));
            livePricesRef.current[sym]=p;
          }
        }catch{}
      }
    };
    fetchOthers();
    const iv=setInterval(fetchOthers,5000);
    return()=>clearInterval(iv);
  },[positions,symbol]);

  const addLog=useCallback((msg,type="info")=>{
    setLog(p=>[{msg,type,time:now()},...p.slice(0,99)]);
  },[]);

  /* ── Deriv balance polling ──────────────────────────────────────────── */
  useEffect(()=>{
    if(!derivEnabled) return;
    const load=async()=>{
      const b=await getDerivBalance();
      if(b){ setDerivBalance(b.balance); setDerivLoginId(b.loginid); }
    };
    load();
    const iv=setInterval(load,30000);
    return()=>clearInterval(iv);
  },[derivEnabled]);

  /* ── Symbol change ───────────────────────────────────────────────────── */
  const handleSymbolChange=useCallback((newSym)=>{
    if(newSym===symbolRef.current)return;
    const newAsset=ASSETS[newSym];
    delete bgPricesRef.current[newSym];
    // Migrate orphaned positions (no symbol field) to current symbol before switching
    // This prevents them from being evaluated against the new symbol's price
    setPositions(prev=>prev.map(p=>!p.symbol?{...p,symbol:symbolRef.current}:p));
    setSymbol(newSym);
    // Do NOT turn off autoMode — bot keeps running for the new symbol

    // TP/SL for the new symbol is applied by the [symbol,positionSize,
    // multiplier] effect below (scaledTpSl) — no need to set it here too.

    setAiResult(null);
    setNextAnalysis(null);
    setCorrSignals({}); corrSignalsRef.current={};

    // Forex/commodity pairs use 5m+ timeframe; 1m candles are too noisy for slow-moving prices
    if((newAsset.type==="forex"||newAsset.type==="commodity") && chartIntervalRef.current==="1m"){
      setChartInterval("5m");
      chartIntervalRef.current="5m";
    } else if(newAsset.type==="crypto" && chartIntervalRef.current!=="1m" && chartIntervalRef.current!=="5m"){
      // Keep user's chosen interval for crypto
    }

    // Use cached real rate if available — prevents TP/SL firing at wrong price
    let initPrice=newAsset.basePrice;
    if(newAsset.type==="forex"||newAsset.type==="commodity"){
      const cacheKey=`${newAsset.forexFrom}_${newAsset.forexTo}`;
      if(_fxCache[cacheKey]?.rate) initPrice=_fxCache[cacheKey].rate;
    }
    const initCandles=genCandles(initPrice,300,chartIntervalRef.current);
    setCandles(initCandles);
    setPrice(initPrice);
    priceRef.current=initPrice;
    const closes=initCandles.map(c=>c.c);
    const initBB=calcBB(closes);
    const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
    const e200=calcEMA(closes,200);
    setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
    setBB(initBB); bbRef.current=initBB;
    setEma9(e9); ema9Ref.current=e9;
    setEma21(e21); ema21Ref.current=e21;
    setEma200(e200); ema200Ref.current=e200;
    const cachedForex=(newAsset.type==="forex"||newAsset.type==="commodity")&&!!_fxCache[`${newAsset.forexFrom}_${newAsset.forexTo}`]?.rate;
    setForexLive(cachedForex);
    // Price not yet confirmed from live feed — block TP/SL watcher until first real tick
    setPriceVerified(cachedForex); // forex/commodity with cache = already verified; crypto = false until Binance responds
    addLog(`🔄 Cambiando a ${newSym}...`,"info");
  },[addLog]);

  /* ── Price tick ──────────────────────────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
    const tfInterval=chartInterval||"1m";
    let iv;
    let derivWs=null;
    let wsAlive=true;

    const applyForexCandles=(newCandles,rate)=>{
      if(!newCandles?.length) return;
      setCandles(newCandles);
      const closes=newCandles.map(c=>c.c);
      const newBB=calcBB(closes);
      const e9=calcEMA(closes,9),e21=calcEMA(closes,21);
      const e200=calcEMA(closes,200);
      const t1h=calcTrend1h(closes);
      const sr=calcSR(newCandles);
      const pts=detectPatterns(newCandles);
      const cpats=detectCandlePatterns(newCandles);
      const st=calcShortTrend(newCandles,5);
      const np=rate||closes.at(-1);
      setPrice(np); priceRef.current=np;
      setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
      setBB(newBB); bbRef.current=newBB;
      setEma9(e9); ema9Ref.current=e9;
      setEma21(e21); ema21Ref.current=e21;
      setEma200(e200); ema200Ref.current=e200;
      setTrend1h(t1h); trend1hRef.current=t1h;
      setPatterns([...pts,...cpats]); patternsRef.current=[...pts,...cpats];
      setShortTrend(st); shortTrendRef.current=st;
      setSrLevels(sr); srRef.current=sr;
      const {forexFrom,forexTo}=cur;
      if(np) _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
      setForexLive(true); setPriceVerified(true);
    };

    if(cur.type==="crypto"){
      const fetchPrice=async()=>{
        try{
          const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cur.binance}`);
          const d=await r.json();
          const np=parseFloat(d.price);
          if(isNaN(np))return;
          priceRef.current=np;
          setPrice(np);
          setPriceVerified(true);
          setCandles(prev=>{
            const updated=[...prev];
            const last={...updated[updated.length-1]};
            const nowSec=Math.floor(Date.now()/1000);
            last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
            const cSecs={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[chartIntervalRef.current]||60;
            if(nowSec - last.time >= cSecs){
              updated.push({time:nowSec,o:np,c:np,h:np,l:np,v:0});
            } else {
              updated[updated.length-1]=last;
            }
            const closes=updated.map(c=>c.c);
            const newBB=calcBB(closes);
            const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
            const t1h=calcTrend1h(closes);
            const pts=detectPatterns(updated);
            const cpats=detectCandlePatterns(updated);
            const allPats=[...pts,...cpats];
            const st=calcShortTrend(updated,5);
            const e200=calcEMA(closes,200);
            setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
            setBB(newBB); bbRef.current=newBB;
            setEma9(e9); ema9Ref.current=e9;
            setEma21(e21); ema21Ref.current=e21;
            setTrend1h(t1h); trend1hRef.current=t1h;
            setPatterns(allPats); patternsRef.current=allPats;
            setShortTrend(st); shortTrendRef.current=st;
            setEma200(e200); ema200Ref.current=e200;
            return updated;
          });
        }catch{}
      };
      fetchPrice();
      iv=setInterval(fetchPrice,3000);

    } else {
      // ── FOREX: Deriv WebSocket for zero-delay real-time candles
      const {forexFrom,forexTo}=cur;
      const derivSym=DERIV_SYMBOLS[symbol];
      const granularity={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[tfInterval]||300;

      // Show placeholder immediately — Deriv WebSocket will replace within ~2s
      const cached=_fxCache[`${forexFrom}_${forexTo}`];
      const initRate=cached?.rate||cur.basePrice;
      applyForexCandles(genCandles(initRate,300,tfInterval),initRate);

      if(!derivSym){
        // No Deriv symbol mapping — use Yahoo Finance candle history + polling
        const tfSecs=granularity;

        // For commodities: fetch real candle history from Yahoo Finance first
        if(cur.yahooTicker){
          (async()=>{
            try{
              const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({yahooSym:cur.yahooTicker,candles:true,limit:500,interval:tfInterval})});
              if(r.ok){
                const d=await r.json();
                if(d.candles?.length>5){
                  const np=d.rate||d.candles.at(-1)?.c;
                  if(np&&!isNaN(np)){
                    _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
                    applyForexCandles(d.candles.map(c=>({...c,v:c.v||0})), np);
                  }
                }
              }
            }catch{}
          })();
        }

        iv=setInterval(async()=>{
          const np=cur.type==="commodity"
            ?await fetchCommodityRateCached(cur.yahooTicker,5000)
            :await fetchForexRateCached(forexFrom,forexTo,2000);
          if(!np||isNaN(np)) return;
          _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
          setPrice(np); priceRef.current=np;
          setPriceVerified(true); setForexLive(true);
          setCandles(prev=>{
            if(!prev.length) return prev;
            const updated=[...prev];
            const lastIdx=updated.length-1;
            const last={...updated[lastIdx]};
            const nowSec=Math.floor(Date.now()/1000);
            last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
            if(nowSec-last.time>=tfSecs) updated.push({time:nowSec,o:np,c:np,h:np,l:np,v:0});
            else updated[lastIdx]=last;
            const closes=updated.map(c=>c.c);
            const newBB=calcBB(closes); bbRef.current=newBB;
            const e9=calcEMA(closes,9),e21=calcEMA(closes,21);
            const e200=calcEMA(closes,200);
            setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
            setBB(newBB); setEma9(e9); ema9Ref.current=e9;
            setEma21(e21); ema21Ref.current=e21;
            setEma200(e200); ema200Ref.current=e200;
            return updated;
          });
        }, cur.type==="commodity"?8000:2000);
        return;
      }

      // ── Deriv WebSocket connection
      const connectWs=()=>{
        if(!wsAlive) return;
        derivWs=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

        derivWs.onopen=()=>{
          if(!wsAlive){derivWs.close();return;}
          // Subscribe to candle history + live stream
          derivWs.send(JSON.stringify({
            ticks_history: derivSym,
            count: 1000,
            style: "candles",
            granularity,
            end: "latest",
            subscribe: 1,
          }));
        };

        derivWs.onmessage=(evt)=>{
          if(!wsAlive) return;
          try{
            const msg=JSON.parse(evt.data);

            if(msg.msg_type==="candles"){
              // Full history from Deriv — replace placeholder candles
              const newCandles=(msg.candles||[]).map(c=>({
                time: parseInt(c.epoch),
                o: parseFloat(c.open),
                h: parseFloat(c.high),
                l: parseFloat(c.low),
                c: parseFloat(c.close),
                v: 0,
              })).filter(c=>c.o&&c.h&&c.l&&c.c);
              if(newCandles.length>5) applyForexCandles(newCandles, newCandles.at(-1)?.c);

            } else if(msg.msg_type==="ohlc"){
              // Live tick — update current candle
              const ohlc=msg.ohlc;
              const np=parseFloat(ohlc.close);
              if(!np||isNaN(np)) return;
              const candleTime=parseInt(ohlc.open_time);
              setPrice(np); priceRef.current=np;
              _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
              setPriceVerified(true); setForexLive(true);
              setCandles(prev=>{
                if(!prev.length) return prev;
                const updated=[...prev];
                const lastIdx=updated.length-1;
                const last={...updated[lastIdx]};
                if(last.time===candleTime){
                  // Update existing current candle
                  last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
                  updated[lastIdx]=last;
                } else if(candleTime>last.time){
                  // New candle started
                  updated.push({time:candleTime,o:parseFloat(ohlc.open),h:parseFloat(ohlc.high),l:parseFloat(ohlc.low),c:np,v:0});
                }
                return updated;
              });

            } else if(msg.msg_type==="error"){
              console.warn("[Deriv WS forex]",msg.error?.message||msg.error);
              // If this commodity has a Yahoo fallback and WS failed, start polling
              if(cur.yahooTicker&&!iv){
                iv=setInterval(async()=>{
                  const np=await fetchCommodityRateCached(cur.yahooTicker,5000);
                  if(!np||isNaN(np)) return;
                  _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
                  setPrice(np); priceRef.current=np;
                  setPriceVerified(true); setForexLive(true);
                  setCandles(prev=>{
                    if(!prev.length) return prev;
                    const updated=[...prev];
                    const lastIdx=updated.length-1;
                    const last={...updated[lastIdx]};
                    const nowSec=Math.floor(Date.now()/1000);
                    last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
                    if(nowSec-last.time>=granularity) updated.push({time:nowSec,o:np,c:np,h:np,l:np,v:0});
                    else updated[lastIdx]=last;
                    return updated;
                  });
                },8000);
              }
            }
          }catch{}
        };

        derivWs.onerror=()=>{};
        derivWs.onclose=()=>{
          // Auto-reconnect after 3s if still active
          if(wsAlive) setTimeout(connectWs, 3000);
        };
      };

      connectWs();
    }

    return()=>{
      wsAlive=false;
      clearInterval(iv);
      if(derivWs){try{derivWs.close();}catch{} derivWs=null;}
    };
  },[symbol,chartInterval]);

  /* ── Binance klines for indicators ──────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
    if(cur.type!=="crypto")return;
    const load=async()=>{
      try{
        const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${cur.binance}&interval=${chartInterval}&limit=1000`);
        const d=await r.json();
        if(!Array.isArray(d))return;
        const newCandles=d.map(k=>({time:Math.floor(parseInt(k[0])/1000),o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])}));
        setCandles(newCandles);
        const closes=newCandles.map(c=>c.c);
        const volumes=newCandles.map(c=>c.v);
        const newBB=calcBB(closes);
        const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
        const vt=calcVolumeTrend(volumes);
        const t1h=calcTrend1h(closes);
        const pts=detectPatterns(newCandles);
        const st=calcShortTrend(newCandles,5);
        const e200=calcEMA(closes,200);
        const sr=calcSR(newCandles);
        const cpats=detectCandlePatterns(newCandles);
        const allPats=[...pts,...cpats];
        setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
        setBB(newBB); bbRef.current=newBB;
        setEma9(e9); ema9Ref.current=e9;
        setEma21(e21); ema21Ref.current=e21;
        setVolTrend(vt); volRef.current=vt;
        setTrend1h(t1h); trend1hRef.current=t1h;
        setPatterns(allPats); patternsRef.current=allPats;
        setShortTrend(st); shortTrendRef.current=st;
        setEma200(e200); ema200Ref.current=e200;
        setSrLevels(sr); srRef.current=sr;
      }catch{}
    };
    const refreshMs={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000}[chartInterval]||60000;
    load();
    const iv=setInterval(load,refreshMs);
    return()=>clearInterval(iv);
  },[symbol,chartInterval]);

  // Forex anchor removed — price + candles now handled in the price tick effect above

  /* ── Multi-asset scanner ─────────────────────────────────────────────── */
  useEffect(()=>{
    // Keeps running in AUTO even if the user never opened the visual scanner
    // panel — this is the data source runAutoScan() below trades off of for
    // every symbol that isn't the one currently on-screen.
    if(!multiMonitor && !autoMode){setAssetSignals({});return;}

    const scan=async()=>{
      const results={};
      for(const [sym,cfg] of Object.entries(ASSETS)){
        try{
          let price;
          if(cfg.type==="crypto"){
            const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binance}`);
            const d=await r.json();
            price=parseFloat(d.price);
          } else if(cfg.type==="commodity"){
            price=await fetchCommodityRateCached(cfg.yahooTicker,10000);
          } else {
            // Each forex pair gets its own correct rate
            price=await fetchForexRateCached(cfg.forexFrom,cfg.forexTo);
          }
          if(!price||isNaN(price))continue;

          if(!bgPricesRef.current[sym])bgPricesRef.current[sym]=[];
          bgPricesRef.current[sym].push(price);
          if(bgPricesRef.current[sym].length>60)bgPricesRef.current[sym].shift();

          const closes=bgPricesRef.current[sym];
          if(closes.length<5){results[sym]={price,signal:"—",color:T.muted};continue;}

          const k9=2/10,k21=2/22;
          let e9=closes[0],e21=closes[0];
          for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
          const rsi=closes.length>14?calcRSI(closes):50;
          const pct=(closes.at(-1)-closes.at(-Math.min(closes.length,30)))/closes.at(-Math.min(closes.length,30))*100;
          const signal=e9>e21&&rsi<70?"BUY":e9<e21&&rsi>30?"SELL":"HOLD";
          const color=signal==="BUY"?T.green:signal==="SELL"?T.red:T.muted;

          // Same confidence/target/stop heuristic as the forex/commodity
          // watchlists (below) so every asset class can feed runAutoScan().
          const recent=closes.slice(-40);
          const maxP=Math.max(...recent), minP=Math.min(...recent);
          const range=maxP-minP||price*0.001;
          const atrEst=range*0.55;
          const prec=cfg.precision;
          const isBuy=signal==="BUY";
          const target=isBuy?price+atrEst*2:price-atrEst*2;
          const stop=isBuy?price-atrEst*1.3:price+atrEst*1.3;
          const pipSz=Math.pow(10,-prec);
          const emaSpreadPips=Math.abs(e9-e21)/pipSz;
          const rsiDiv=isBuy?Math.max(0,60-rsi):Math.max(0,rsi-40);

          // Pattern + S/R confluence bonus — same confluence idea api/analyze.js
          // and backtest/lib/strategy.mjs already use for the validated symbols,
          // now also informing symbols you aren't actively charting.
          const pseudoCandles=buildPseudoCandles(closes,3);
          const bgPatterns=pseudoCandles.length>=3?detectCandlePatterns(pseudoCandles):[];
          const wantDir=isBuy?"BULLISH":"BEARISH";
          const dirPatterns=bgPatterns.filter(p=>p.signal===wantDir);
          const bgSr=pseudoCandles.length>=20?calcSR(pseudoCandles):{supports:[],resistances:[]};
          const nearSupport=bgSr.supports?.[0]&&Math.abs(price-bgSr.supports[0].price)/price<0.0015;
          const nearResistance=bgSr.resistances?.[0]&&Math.abs(price-bgSr.resistances[0].price)/price<0.0015;
          const srBonus=(isBuy&&nearSupport)||(!isBuy&&nearResistance)?8:0;
          const patternBonus=dirPatterns.length?8:0;

          const confidence=signal==="HOLD"?0:Math.min(88,Math.max(45,
            Math.round(50+emaSpreadPips*0.3+rsiDiv*0.5+patternBonus+srBonus)));

          results[sym]={price,signal,color,rsi:rsi.toFixed(0),pct,confidence,target,stop,prec,entry:price,
            patterns:dirPatterns.map(p=>p.name)};
        }catch{}
      }
      setAssetSignals(results);
    };
    scan();
    const iv=setInterval(scan,10000);
    return()=>clearInterval(iv);
  },[multiMonitor,autoMode]);

  /* ── Forex watchlist — always running, all forex pairs ──────────────── */
  useEffect(()=>{
    const FOREX_SYMBOLS=["EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/JPY","USD/CHF","USD/CAD","EUR/GBP"];
    const scan=async()=>{
      const results={};
      for(const sym of FOREX_SYMBOLS){
        const cfg=ASSETS[sym];
        if(!cfg)continue;
        try{
          const p=await fetchForexRateCached(cfg.forexFrom,cfg.forexTo);
          if(!p||isNaN(p))continue;
          if(!bgPricesRef.current[sym])bgPricesRef.current[sym]=[];
          bgPricesRef.current[sym].push(p);
          if(bgPricesRef.current[sym].length>120)bgPricesRef.current[sym].shift();
          const closes=bgPricesRef.current[sym];
          const k9=2/10,k21=2/22;
          let e9=closes[0],e21=closes[0];
          for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
          const rsi=closes.length>14?calcRSI(closes):50;
          const signal=e9>e21&&rsi<70?"BUY":e9<e21&&rsi>30?"SELL":"HOLD";
          const color=signal==="BUY"?T.green:signal==="SELL"?T.red:T.muted;
          const pct=closes.length>1?(closes.at(-1)-closes[0])/closes[0]*100:0;

          // ATR estimate from recent price range
          const recent=closes.slice(-40);
          const maxP=Math.max(...recent);
          const minP=Math.min(...recent);
          const range=maxP-minP||p*0.001;
          const atrEst=range*0.55;
          const prec=cfg.precision;
          const isBuy=signal==="BUY";
          const target=isBuy?p+atrEst*2:p-atrEst*2;
          const stop=isBuy?p-atrEst*1.3:p+atrEst*1.3;
          // pip size: JPY pairs use 0.01, rest use 0.0001
          const pipSz=prec<=3?0.01:0.0001;
          const targetPips=Math.abs(target-p)/pipSz;
          const stopPips=Math.abs(stop-p)/pipSz;
          const rr=stopPips>0?(targetPips/stopPips).toFixed(1):"—";
          // confidence: EMA spread + RSI divergence from 50
          const emaSpreadPips=Math.abs(e9-e21)/pipSz;
          const rsiDiv=isBuy?Math.max(0,60-rsi):Math.max(0,rsi-40);
          const confidence=signal==="HOLD"?0:Math.min(88,Math.max(45,Math.round(50+emaSpreadPips*0.3+rsiDiv*0.5)));

          results[sym]={price:p,signal,color,rsi:Math.round(rsi),pct,samples:closes.length,
            target,stop,rr,targetPips:targetPips.toFixed(1),stopPips:stopPips.toFixed(1),
            confidence,prec,entry:p,sparkline:closes.slice(-24)};
        }catch{}
      }
      setForexWatch(results);
    };
    scan();
    const iv=setInterval(scan,15000);
    return()=>clearInterval(iv);
  },[]);

  /* ── Commodity watchlist — always running, 3 commodities ────────────── */
  useEffect(()=>{
    const COMMODITY_SYMS=["XAU/USD","XAG/USD","XTI/USD"];
    const scan=async()=>{
      const results={};
      for(const sym of COMMODITY_SYMS){
        const cfg=ASSETS[sym];
        if(!cfg)continue;
        try{
          // Try Deriv WS cache first (populated when that commodity is active)
          const cacheKey=`${cfg.forexFrom}_${cfg.forexTo}`;
          let p=_fxCache[cacheKey]?.rate;
          // Fallback: Yahoo Finance via serverless proxy
          if(!p) p=await fetchCommodityRateCached(cfg.yahooTicker,30000);
          if(!p||isNaN(p))continue;

          if(!bgPricesRef.current[sym])bgPricesRef.current[sym]=[];
          bgPricesRef.current[sym].push(p);
          if(bgPricesRef.current[sym].length>120)bgPricesRef.current[sym].shift();
          const closes=bgPricesRef.current[sym];
          const k9=2/10,k21=2/22;
          let e9=closes[0],e21=closes[0];
          for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
          const rsi=closes.length>14?calcRSI(closes):50;
          const signal=e9>e21&&rsi<70?"BUY":e9<e21&&rsi>30?"SELL":"HOLD";
          const color=signal==="BUY"?T.green:signal==="SELL"?T.red:T.muted;
          const pct=closes.length>1?(closes.at(-1)-closes[0])/closes[0]*100:0;

          // ATR estimate
          const recent=closes.slice(-40);
          const maxP=Math.max(...recent), minP=Math.min(...recent);
          const range=maxP-minP||p*0.002;
          const atrEst=range*0.55;
          const prec=cfg.precision;
          const isBuy=signal==="BUY";
          const target=isBuy?p+atrEst*2:p-atrEst*2;
          const stop=isBuy?p-atrEst*1.3:p+atrEst*1.3;
          // Commodities use dollar-based pip (0.01 for 2dp, 0.001 for 3dp)
          const pipSz=Math.pow(10,-prec);
          const targetPips=Math.abs(target-p)/pipSz;
          const stopPips=Math.abs(stop-p)/pipSz;
          const rr=stopPips>0?(targetPips/stopPips).toFixed(1):"—";
          const emaSpreadPips=Math.abs(e9-e21)/pipSz;
          const rsiDiv=isBuy?Math.max(0,60-rsi):Math.max(0,rsi-40);
          const confidence=signal==="HOLD"?0:Math.min(88,Math.max(45,Math.round(50+emaSpreadPips*0.3+rsiDiv*0.5)));

          results[sym]={price:p,signal,color,rsi:Math.round(rsi),pct,samples:closes.length,
            target,stop,rr,targetPips:targetPips.toFixed(1),stopPips:stopPips.toFixed(1),
            confidence,prec,entry:p,sparkline:closes.slice(-24)};
        }catch{}
      }
      setCommodityWatch(results);
    };
    scan();
    const iv=setInterval(scan,20000);
    return()=>clearInterval(iv);
  },[]);

  /* ── Correlation monitor (always runs for forex pairs) ──────────────── */
  useEffect(()=>{
    const corrs=asset.correlations||{};
    if(!Object.keys(corrs).length){setCorrSignals({});corrSignalsRef.current={};return;}

    const fetchCorr=async()=>{
      const results={};
      for(const [sym,direction] of Object.entries(corrs)){
        const cfg=ASSETS[sym];
        if(!cfg)continue;
        try{
          let price;
          if(cfg.type==="crypto"){
            const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binance}`);
            const d=await r.json();
            price=parseFloat(d.price);
          } else {
            price=await fetchForexRateCached(cfg.forexFrom,cfg.forexTo);
          }
          if(!price||isNaN(price))continue;

          if(!bgPricesRef.current[sym])bgPricesRef.current[sym]=[];
          bgPricesRef.current[sym].push(price);
          if(bgPricesRef.current[sym].length>60)bgPricesRef.current[sym].shift();

          const closes=bgPricesRef.current[sym];
          const k9=2/10,k21=2/22;
          let e9=closes[0],e21=closes[0];
          for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
          const rsi=closes.length>14?calcRSI(closes):50;
          const signal=e9>e21&&rsi<70?"BUY":e9<e21&&rsi>30?"SELL":"HOLD";
          // confirms is relative to active pair's own trend — same logic as runAnalysis
          const activeIsBull=ema9Ref.current>ema21Ref.current;
          const confirms=activeIsBull
            ?(direction>0&&signal==="BUY")||(direction<0&&signal==="SELL")
            :(direction>0&&signal==="SELL")||(direction<0&&signal==="BUY");
          const color=signal==="BUY"?T.green:signal==="SELL"?T.red:T.muted;
          results[sym]={price,signal,direction,rsi:Math.round(rsi),confirms,color,
            precision:cfg.precision,samples:closes.length};
        }catch{}
      }
      setCorrSignals(results);
      corrSignalsRef.current=results;
    };

    fetchCorr();
    const iv=setInterval(fetchCorr,15000);
    return()=>clearInterval(iv);
  },[symbol]);

  /* ── Close position ──────────────────────────────────────────────────── */
  const closePosition=useCallback((posId,currentPrice,reason)=>{
    setPositions(prev=>{
      const pos=prev.find(p=>p.id===posId);
      if(!pos)return prev;
      if(derivEnabledRef.current && pos.derivContractId){
        closeDerivOrder(pos.derivContractId)
          .then(r=>{ if(!r.ok) console.warn("Deriv close error:",r.error); });
      }
      deletePositionOpen(pos.id);
      const pnl=posPnL(pos,currentPrice,pos.allocatedSize||positionSizeRef.current);
      const posSym=pos.symbol||symbolRef.current;
      const prec=ASSETS[posSym]?.precision||ASSETS[symbolRef.current].precision;
      const emoji=reason==="TP"?"✅":reason==="SL"?"🛑":reason==="TRAIL"?"🔒":"⬜";
      addLog(`${emoji} ${reason} ${pos.type} ${posSym} @ ${fP(currentPrice,prec)} → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      setBalance(b=>{const nb=b+pnl;balanceRef.current=nb;return nb;});
      const closedTrade={...pos,exit:currentPrice,pnl,reason,time:now(),tradeTime:Math.floor(Date.now()/1000),
        symbol:posSym, activePatterns:patternsRef.current.map(p=>p.name)};
      setTrades(t=>[closedTrade,...t.slice(0,49)]);
      saveTradeLearning(closedTrade);
      setLearningStats(calcLearningStats(loadTrades()));
      // Persist to Postgres too (fire-and-forget) — localStorage above is the
      // instant/offline fallback, this is what makes learning survive a
      // closed browser or a different device. See api/trades.js.
      fetch("/api/trades",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          symbol:closedTrade.symbol, type:closedTrade.type,
          entryPrice:closedTrade.entry, exitPrice:currentPrice, pnl,
          patterns:closedTrade.activePatterns, closeReason:reason,
          openedAt:closedTrade.openTime?new Date(closedTrade.openTime).toISOString():undefined,
        }),
      }).catch(()=>{});
      saveBalance(balanceRef.current+pnl);
      setClosedCount(c=>c+1);
      setTotalProfit(p=>p+pnl);
      // Track consecutive losses — reset on profit, increment on SL
      if(reason==="SL"){
        const newLosses=consLossesRef.current+1;
        consLossesRef.current=newLosses;
        setConsLosses(newLosses);
        if(newLosses>=3){
          // Pause 2 analysis cycles to avoid revenge trading
          skipCyclesRef.current=2; setSkipCycles(2);
          addLog(`⚠️ ${newLosses} SL consecutivos — pausando 2 ciclos para reevaluar tendencia`,"sell");
        }
      } else if(pnl>0){
        consLossesRef.current=0; setConsLosses(0);
      }
      if(reason==="TP"&&autoRef.current){
        pendingAnalysisRef.current=true;
        setAutoPhase("tp_hit_analyzing");
      }
      return prev.filter(p=>p.id!==posId);
    });
  },[addLog]);

  /* ── TP / SL watcher — active symbol ────────────────────────────────── */
  useEffect(()=>{
    if(!priceVerified) return;
    const peakUpdates=[];
    posRef.current
      .filter(p=>p.symbol===symbol)
      .forEach(pos=>{
        // Each position carries its own tp/sl (scaled for ITS symbol) since
        // multiple symbols can be open at once — falls back to the active
        // symbol's current tpTarget/slTarget only for older positions that
        // predate that field.
        const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
        const pnl=posPnL(pos,price,pos.allocatedSize||positionSize);
        const peakPnl=Math.max(pos.peakPnl||0,pnl);
        const stopLevel=trailingStopLevel(peakPnl,posTp,posSl);
        if(pnl>=posTp)               closePosition(pos.id,price,"TP");
        else if(pnl<=stopLevel)      closePosition(pos.id,price,stopLevel>0?"TRAIL":"SL");
        else if(peakPnl!==(pos.peakPnl||0)) peakUpdates.push({id:pos.id,peakPnl});
      });
    if(peakUpdates.length){
      setPositions(prev=>prev.map(p=>{
        const u=peakUpdates.find(x=>x.id===p.id);
        return u?{...p,peakPnl:u.peakPnl}:p;
      }));
    }
  },[price,symbol,priceVerified,closePosition,tpTarget,slTarget,positionSize]);

  /* ── TP / SL watcher — non-active symbols (uses livePrices) ──────────── */
  useEffect(()=>{
    const peakUpdates=[];
    posRef.current
      .filter(p=>p.symbol&&p.symbol!==symbol)
      .forEach(pos=>{
        const cp=livePrices[pos.symbol];
        const cfg=ASSETS[pos.symbol];
        if(!cp||cp===cfg?.basePrice) return;
        const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
        const pnl=posPnL(pos,cp,pos.allocatedSize||positionSize);
        const peakPnl=Math.max(pos.peakPnl||0,pnl);
        const stopLevel=trailingStopLevel(peakPnl,posTp,posSl);
        if(pnl>=posTp)               closePosition(pos.id,cp,"TP");
        else if(pnl<=stopLevel)      closePosition(pos.id,cp,stopLevel>0?"TRAIL":"SL");
        else if(peakPnl!==(pos.peakPnl||0)) peakUpdates.push({id:pos.id,peakPnl});
      });
    if(peakUpdates.length){
      setPositions(prev=>prev.map(p=>{
        const u=peakUpdates.find(x=>x.id===p.id);
        return u?{...p,peakPnl:u.peakPnl}:p;
      }));
    }
  },[livePrices,symbol,closePosition,tpTarget,slTarget,positionSize]);

  /* ── Core analyze ────────────────────────────────────────────────────── */
  const runAnalysis=useCallback(async(reason="Ciclo automático")=>{
    if(analyzing)return;
    // Skip cycles after consecutive losses
    if(skipCyclesRef.current>0){
      const remaining=skipCyclesRef.current-1;
      skipCyclesRef.current=remaining; setSkipCycles(remaining);
      addLog(`⏭ Ciclo pausado (protección racha pérdidas). Quedan ${remaining} ciclo(s).`,"info");
      setAutoPhase("waiting_conditions");
      return;
    }
    // ── Market-closed hard stop (weekend) — forex/commodities fully close
    // Fri 22:00 UTC → Sun 22:00 UTC. This is separate from (and checked
    // before) the intraday low-liquidity filter below: a Saturday afternoon
    // has plenty of "hour of day" but the market simply isn't open at all.
    const curAsset=ASSETS[symbolRef.current];
    if((curAsset?.type==="forex"||curAsset?.type==="commodity") && !isForexMarketOpen()){
      addLog(`🔒 Mercado cerrado (fin de semana) — ${symbolRef.current} reabre el domingo 22:00 UTC.`,"info");
      setAutoPhase("waiting_conditions");
      setAnalyzing(false);
      return;
    }
    // ── Trading session filter for forex (don't trade during Asian dead hours)
    // Commodities (Gold, Silver, Oil) trade nearly 24/5 — skip this filter
    if(curAsset?.type==="forex"){
      const utcHour=new Date().getUTCHours();
      // London session: 07:00-17:00 UTC | NY session: 12:00-21:00 UTC
      // Overlap (best): 12:00-17:00 UTC | Avoid: 21:00-06:00 UTC (low liquidity)
      const inAsianOnly=utcHour>=21||utcHour<6; // dead hours: 21:00–06:00 UTC
      if(inAsianOnly&&reason.includes("Ciclo")){
        addLog(`🌙 Sesión asiática (${utcHour}:00 UTC) — baja liquidez. Esperando apertura Londres (07:00 UTC).`,"info");
        setAutoPhase("waiting_conditions");
        setAnalyzing(false);
        return;
      }
    }

    setAnalyzing(true);
    setAutoPhase("analyzing");

    // ── Learning feedback: derive dynamic confidence threshold from trade history
    const trades=loadTrades();
    let minConf=62; // base threshold — enough to filter noise but not too strict
    if(trades.length>=20){   // need 20+ trades for reliable statistics
      const recent=trades.slice(0,20);
      const recentWR=recent.filter(t=>t.pnl>0).length/recent.length;
      // Adjust confidence requirement based on recent win rate
      if(recentWR<0.35)      minConf=73; // losing badly → more strict
      else if(recentWR<0.45) minConf=68; // below avg → cautious
      else if(recentWR<0.55) minConf=64; // around avg → slightly cautious
      else if(recentWR>=0.65)minConf=60; // winning well → relaxed
    }
    // Prefer THIS symbol's own recent record over the blended global one,
    // once it has enough trades of its own to be meaningful.
    minConf=getSymbolMinConf(trades,symbolRef.current,minConf);
    const byPatternStats=calcLearningStats(trades)?.byPattern||[];

    // ── Apply the walk-forward-validated tier for this symbol on top of the
    // learning-derived threshold: MIXTO/ROBUSTO raise the bar, SIN-EDGE blocks
    // auto-open outright (see SYMBOL_STRATEGY definition near ASSETS).
    const stratCfg=SYMBOL_STRATEGY[symbolRef.current];
    const symbolAutoDisabled=stratCfg?.tier==="SIN-EDGE";
    if(stratCfg?.minConf) minConf=Math.max(minConf,stratCfg.minConf);

    setDynamicMinConf(minConf);
    addLog(`🔍 Analizando ${symbolRef.current}: ${reason} | umbral dinámico: ${minConf}%${symbolAutoDisabled?" | ⛔ auto-trading desactivado (sin edge validado)":""}`,"info");
    try{
      // Build correlation array for AI
      // Compute confirms based on dominant EMA direction (not fixed BUY bias)
      const activeIsBull=ema9Ref.current>ema21Ref.current;
      const corrArray=Object.entries(corrSignalsRef.current).map(([sym,info])=>{
        // A corr pair CONFIRMS when it moves in the direction expected given correlation + active trend
        // Positive corr: pair should go same direction as active → BUY confirms BUY, SELL confirms SELL
        // Negative corr: pair should go opposite → SELL confirms active BUY, BUY confirms active SELL
        const confirms=activeIsBull
          ?(info.direction>0&&info.signal==="BUY")||(info.direction<0&&info.signal==="SELL")
          :(info.direction>0&&info.signal==="SELL")||(info.direction<0&&info.signal==="BUY");
        return{symbol:sym,signal:info.signal,direction:info.direction,confirms,rsi:info.rsi};
      });

      const result=await analyzeMarketAI({
        symbol:symbolRef.current,
        price:priceRef.current,  rsi:rsiRef.current,
        macd:macdRef.current,    bb:bbRef.current,
        ema9:ema9Ref.current,    ema21:ema21Ref.current,
        volRatio:volRef.current.ratio, trend1h:trend1hRef.current,
        shortTrend:shortTrendRef.current,
        consecutiveLosses:consLossesRef.current,
        ema200:ema200Ref.current,
        srLevels:srRef.current,
        patterns:patternsRef.current,
        correlations:corrArray,
        positions:posRef.current, balance:balanceRef.current,
        news:newsRef.current,
        marketBias:newsDataRef.current?.market_bias||"neutral",
        newsSummary:newsDataRef.current?.summary||"",
        reason,
        positionSize:positionSizeRef.current,
        tpTarget:tpTargetRef.current, slTarget:slTargetRef.current,
        activePrediction:activePredRef.current,
      });

      // ── Pattern feedback: nudge confidence using how THESE exact patterns
      // have actually performed historically (byPatternStats), instead of
      // only showing that stat on a panel nobody's decision ever reads.
      if(result.signal!=="HOLD"){
        const activePatNames=patternsRef.current.map(p=>p.name);
        const {delta,note}=getPatternAdjustment(activePatNames,byPatternStats);
        if(delta!==0){
          result.confidence=Math.max(0,Math.min(99,result.confidence+delta));
          result.reasoning=`[Aprendizaje: ${note}, ${delta>0?"+":""}${delta}%] ${result.reasoning}`;
        }
      }

      setAiResult(result);
      addLog(`📡 ${result.signal} (${result.confidence}%) — ${result.key_factor}`,
        result.signal==="BUY"?"buy":result.signal==="SELL"?"sell":"info");

      // ── Medium-term prediction persistence ──────────────────────────────
      const curr=activePredRef.current;
      const validSignal=result.signal!=="HOLD"&&result.should_open&&result.confidence>=minConf;
      const sameDir=curr&&curr.signal===result.signal;
      const oppositeDir=curr&&result.signal!=="HOLD"&&curr.signal!==result.signal;
      const cp2=priceRef.current;
      const prec2=ASSETS[symbolRef.current]?.precision||5;
      const rc=candlesRef.current;
      const recentC=rc.slice(-14);
      const atrEst=recentC.length>0?recentC.reduce((s,c)=>s+(c.h-c.l),0)/recentC.length:cp2*0.001;

      if(validSignal&&!curr){
        // New prediction
        const ib=result.signal==="BUY";
        const pred={
          signal:result.signal,confidence:result.confidence,
          entryPrice:cp2,
          targetPrice:ib?cp2+atrEst*2.5:cp2-atrEst*2.5,
          stopPrice:ib?cp2-atrEst*1.5:cp2+atrEst*1.5,
          timestamp:Date.now(),confirmations:1,invalidations:0,holdCount:0,
          reasoning:result.reasoning,symbol:symbolRef.current,key_factor:result.key_factor,
        };
        setActivePrediction(pred); activePredRef.current=pred;
        addLog(`📊 PREDICCIÓN NUEVA: ${result.signal} ${symbolRef.current} @ ${fP(cp2,prec2)} — ${result.key_factor}`,"info");
      } else if(curr&&sameDir){
        // Confirm existing prediction
        const updated={...curr,
          confidence:Math.round(Math.min(99,curr.confidence*0.6+result.confidence*0.4)),
          confirmations:curr.confirmations+1,holdCount:0,
          reasoning:result.reasoning,key_factor:result.key_factor,
        };
        setActivePrediction(updated); activePredRef.current=updated;
        addLog(`✅ CONFIRMACIÓN ${updated.confirmations}×: ${curr.signal} ${curr.symbol} — tendencia activa`,"info");
      } else if(curr&&oppositeDir&&result.confidence>=70){
        // Counter-signal
        const invCount=curr.invalidations+1;
        if(invCount>=2){
          const ib2=result.signal==="BUY";
          const newPred={
            signal:result.signal,confidence:result.confidence,
            entryPrice:cp2,
            targetPrice:ib2?cp2+atrEst*2.5:cp2-atrEst*2.5,
            stopPrice:ib2?cp2-atrEst*1.5:cp2+atrEst*1.5,
            timestamp:Date.now(),confirmations:1,invalidations:0,holdCount:0,
            reasoning:result.reasoning,symbol:symbolRef.current,key_factor:result.key_factor,
          };
          setActivePrediction(newPred); activePredRef.current=newPred;
          addLog(`🔄 CAMBIO DE TENDENCIA: ${curr.signal}→${result.signal} ${symbolRef.current} (${invCount} invalidaciones)`,result.signal==="BUY"?"buy":"sell");
        } else {
          const upd={...curr,invalidations:invCount};
          setActivePrediction(upd); activePredRef.current=upd;
          addLog(`⚠️ SEÑAL CONTRARIA (${invCount}/2): ${result.signal} conf${result.confidence}% — manteniendo ${curr.signal}`,"info");
        }
      } else if(curr&&result.signal==="HOLD"){
        const hc=(curr.holdCount||0)+1;
        if(hc>=6){
          addLog(`⏰ PREDICCIÓN ${curr.signal} expirada — 6 ciclos sin confirmar (~30min)`,"info");
          setActivePrediction(null); activePredRef.current=null;
        } else {
          const upd={...curr,holdCount:hc};
          setActivePrediction(upd); activePredRef.current=upd;
        }
      }
      // ────────────────────────────────────────────────────────────────────

      if(autoRef.current){
        const activeSym=symbolRef.current;
        const symSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===activeSym).length;
        if(!symbolAutoDisabled&&result.should_open&&result.signal!=="HOLD"&&symSlots>0&&result.confidence>=minConf){
          const isBuy=result.signal==="BUY";
          const cp=priceRef.current;
          const prec=ASSETS[activeSym].precision;
          const activeAssetCheck=ASSETS[activeSym];
          const ps=positionSizeRef.current;

          // ── Deriv order for forex pairs
          let derivContractId=null;
          if(derivEnabledRef.current && activeAssetCheck?.type==="forex"){
            const dResult=await openDerivOrder(activeSym,result.signal,ps,multiplierRef.current,tpTargetRef.current,slTargetRef.current);
            if(dResult.ok){
              derivContractId=dResult.contractId;
              addLog(`🔵 Deriv orden ${result.signal} abierta | ContractID:${derivContractId} | Stake:$${ps} × ${multiplierRef.current}x @ ${dResult.buyPrice}`,"info");
            } else {
              addLog(`⚠️ Deriv: ${dResult.error} — posición registrada en simulación`,"sell");
            }
          }

          const mainScaled=scaledTpSl(activeSym,ps,multiplierRef.current);
          const mainPos={type:result.signal,entry:cp,id:Date.now()+Math.random(),
            symbol:activeSym,openTime:Date.now(),allocatedSize:ps,multiplier:multiplierRef.current,peakPnl:0,
            tp:mainScaled?.tp??tpTargetRef.current, sl:mainScaled?.sl??slTargetRef.current,
            ...(derivContractId&&{derivContractId})};

          // ── Open correlated positions on all forex pairs with a confirmed correlation
          const corrPositions=[];
          if(activeAssetCheck?.type==="forex"){
            const corrs=activeAssetCheck.correlations||{};
            for(const [corrSym,corrDir] of Object.entries(corrs)){
              const corrAsset=ASSETS[corrSym];
              if(!corrAsset||corrAsset.type!=="forex") continue;
              // Get real price from cache — skip if only basePrice available
              const cacheKey=`${corrAsset.forexFrom}_${corrAsset.forexTo}`;
              const corrPrice=_fxCache[cacheKey]?.rate;
              if(!corrPrice||corrPrice===corrAsset.basePrice) continue;
              // Check slot availability for this corr pair
              const corrSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===corrSym).length;
              if(corrSlots<=0) continue;
              // Direction: same signal for positive corr, opposite for negative corr
              const corrSignal=corrDir>0?result.signal:(isBuy?"SELL":"BUY");
              // Skip if the correlated pair's own signal actively contradicts the expected direction
              const corrInfo=corrSignalsRef.current[corrSym];
              if(corrInfo?.signal&&corrInfo.signal!=="HOLD"&&corrInfo.signal!==corrSignal) continue;
              // Deriv correlated order
              let corrDerivId=null;
              if(derivEnabledRef.current){
                const dCorr=await openDerivOrder(corrSym,corrSignal,ps,multiplierRef.current,tpTargetRef.current,slTargetRef.current);
                if(dCorr.ok) corrDerivId=dCorr.contractId;
              }
              const corrScaled=scaledTpSl(corrSym,ps,multiplierRef.current);
              corrPositions.push({
                type:corrSignal,entry:corrPrice,id:Date.now()+Math.random()+corrPositions.length*0.001,
                symbol:corrSym,openTime:Date.now(),correlatedWith:activeSym,allocatedSize:ps,multiplier:multiplierRef.current,peakPnl:0,
                tp:corrScaled?.tp??tpTargetRef.current, sl:corrScaled?.sl??slTargetRef.current,
                ...(corrDerivId&&{derivContractId:corrDerivId}),
              });
              addLog(`🔗 ${corrSignal==="BUY"?"🟢":"🔴"} CORR ${corrSignal} ${corrSym} @ ${fP(corrPrice,corrAsset.precision)} (${corrDir>0?"↑↑":"↓↑"} ${activeSym})`,corrSignal==="BUY"?"buy":"sell");
            }
          }

          setPositions(p=>[...p,mainPos,...corrPositions]);
          [mainPos,...corrPositions].forEach(p=>savePositionOpen(p,result.confidence));
          addLog(`${isBuy?"🟢 BUY":"🔴 SELL"} ${activeSym} @ ${fP(cp,prec)} | ${ps.toFixed(2)}L | TP:+${fUSD(tpTargetRef.current)} SL:-${fUSD(slTargetRef.current)}${corrPositions.length?` + ${corrPositions.length} correlacionadas`:""}`,isBuy?"buy":"sell");
          setAutoPhase("monitoring");
        } else {
          const why=symbolAutoDisabled?"símbolo sin ventaja validada — auto-trading desactivado"
            :!result.should_open?`IA dice no abrir (${result.signal} ${result.confidence}%)`
            :result.confidence<minConf?`confianza ${result.confidence}% < umbral mín ${minConf}%`
            :symSlots===0?"slots llenos (3/3)":"señal HOLD";
          addLog(`⏸ Sin abrir — ${why}. Esperando próximo ciclo.`,"info");
          setBlockReason(why);
          setAutoPhase("waiting_conditions");
        }
      }
    }catch(e){
      addLog("❌ Error IA: "+e.message,"sell");
      setAutoPhase("waiting_conditions");
    }
    setAnalyzing(false);
    pendingAnalysisRef.current=false;
  },[analyzing,addLog]);

  /* ── Scheduled auto-start: turn AUTO on by itself at a chosen date/time ── */
  useEffect(()=>{
    if(!scheduledStart){ setScheduleRemainingMs(null); return; }
    setScheduleRemainingMs(Math.max(0,scheduledStart-Date.now()));
    const iv=setInterval(()=>{
      if(autoRef.current){ setScheduledStart(null); return; } // user started manually meanwhile
      if(Date.now()>=scheduledStart){
        setAutoMode(true);
        setScheduledStart(null);
        addLog(`⏰ Hora programada alcanzada — activando AUTO`,"info");
      } else {
        setScheduleRemainingMs(scheduledStart-Date.now());
      }
    },1000);
    return()=>clearInterval(iv);
  },[scheduledStart,addLog]);

  /* ── Multi-symbol auto-scan ───────────────────────────────────────────
     AUTO no se limita al símbolo que tienes en pantalla: cada ciclo también
     revisa todos los demás símbolos ROBUSTO/MIXTO (el activo ya recibe el
     análisis completo con IA arriba) usando la señal técnica determinista
     de assetSignals — la misma clase de regla que valida el walk-forward,
     sin gastar una llamada a Groq por símbolo. Solo simulado (paper): nunca
     manda órdenes a Deriv, sin importar derivEnabled, porque son símbolos
     que no estás mirando activamente. Respeta el cupo por símbolo
     (MAX_POSITIONS) y el cupo global (MAX_TOTAL_POSITIONS). */
  const runAutoScan=useCallback(()=>{
    if(!autoRef.current) return;
    if(posRef.current.length>=MAX_TOTAL_POSITIONS) return;
    const allTrades=loadTrades();
    const byPatternStats=calcLearningStats(allTrades)?.byPattern||[];
    for(const [sym,strat] of Object.entries(SYMBOL_STRATEGY)){
      if(strat.tier==="SIN-EDGE") continue;
      if(sym===symbolRef.current) continue; // ya lo cubre el análisis principal
      if(posRef.current.length>=MAX_TOTAL_POSITIONS) break;
      if(!isMarketOpen(ASSETS[sym]?.type)) continue; // forex/materias cerrados el fin de semana
      const symSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===sym).length;
      if(symSlots<=0) continue;
      const data=assetSignalsRef.current[sym];
      if(!data||data.signal==="HOLD"||!data.confidence) continue;

      // Same two learning feedback loops as the active symbol: this symbol's
      // own recent record (not the global blend) and how its detected
      // patterns have historically performed.
      const baseMinConf=consLossesRef.current>=2?Math.min(90,strat.minConf+10):strat.minConf;
      const minConf=getSymbolMinConf(allTrades,sym,baseMinConf);
      const {delta,note}=getPatternAdjustment(data.patterns,byPatternStats);
      const adjConfidence=Math.max(0,Math.min(99,data.confidence+delta));
      if(adjConfidence<minConf) continue;

      const ps=positionSizeRef.current;
      const scaled=scaledTpSl(sym,ps,multiplierRef.current);
      const pos={
        type:data.signal, entry:data.price, id:Date.now()+Math.random(),
        symbol:sym, openTime:Date.now(), allocatedSize:ps, multiplier:multiplierRef.current, peakPnl:0,
        tp:scaled?.tp??tpTargetRef.current, sl:scaled?.sl??slTargetRef.current,
      };
      setPositions(p=>[...p,pos]);
      savePositionOpen(pos,adjConfidence);
      addLog(`🌐 ${data.signal==="BUY"?"🟢":"🔴"} ${data.signal} ${sym} @ ${fP(data.price,data.prec||5)} (auto multi-símbolo, ${strat.tier}, conf ${adjConfidence}%${note?` · ${note}`:""})`,data.signal==="BUY"?"buy":"sell");
    }
  },[addLog]);

  /* ── Auto loop ───────────────────────────────────────────────────────── */
  useEffect(()=>{
    clearInterval(timerRef.current);
    clearInterval(countRef.current);
    if(!autoMode){setAutoPhase("idle");setNextAnalysis(null);return;}

    addLog(`🤖 AUTO ACTIVADO — TP:+${fUSD(tpTargetRef.current)} | SL:-${fUSD(slTargetRef.current)} | Máx ${MAX_POSITIONS} pos/símbolo, ${MAX_TOTAL_POSITIONS} en total | escaneando todos los símbolos validados`,"info");
    runAnalysis("Inicio modo automático");
    runAutoScan();

    let remaining=ANALYSIS_INTERVAL_MS;
    countRef.current=setInterval(()=>{
      remaining-=1000;
      setNextAnalysis(remaining);
      if(remaining<=0)remaining=ANALYSIS_INTERVAL_MS;
    },1000);

    timerRef.current=setInterval(()=>{
      remaining=ANALYSIS_INTERVAL_MS;
      if(!autoRef.current)return;
      const symCount=posRef.current.filter(p=>p.symbol===symbolRef.current).length;
      if(symCount<MAX_POSITIONS) runAnalysis("Ciclo automático regular");
      else setAutoPhase("monitoring");
      runAutoScan();
    },ANALYSIS_INTERVAL_MS);

    return()=>{clearInterval(timerRef.current);clearInterval(countRef.current);};
  },[autoMode,runAutoScan]);

  /* ── React to TP hit → re-analyze ───────────────────────────────────── */
  useEffect(()=>{
    if(!pendingAnalysisRef.current||analyzing)return;
    if(autoRef.current&&posRef.current.length<MAX_TOTAL_POSITIONS){
      setTimeout(()=>{
        if(autoRef.current) runAnalysis("Re-análisis post TP — evaluando nueva entrada");
      },1500);
    }
  },[positions,analyzing,runAnalysis]);

  /* ── Load news — with 30-min frontend cache to protect API quota ─────── */
  const NEWS_FRONTEND_TTL = 30 * 60 * 1000; // 30 minutes
  const loadNews=useCallback(async(sym,force=false)=>{
    const target=sym||symbolRef.current;
    // Serve from frontend cache if fresh and not forced
    if(!force){
      const cached=newsCacheRef.current[target];
      if(cached&&Date.now()-cached.ts<NEWS_FRONTEND_TTL){
        setNewsData(cached.data); setNews(cached.data.headlines||[]);
        addLog(`📰 ${cached.data.headlines?.length||0} noticias (cache) — Sesgo: ${(cached.data.market_bias||"neutral").toUpperCase()}`,"info");
        return;
      }
    }
    setLoadingNews(true);
    addLog(`📰 Obteniendo noticias ${target}...`,"info");
    try{
      const d=await fetchNewsAI(target);
      // Cache even stale/fallback responses so we don't retry immediately
      newsCacheRef.current[target]={data:d, ts:Date.now()};
      setNewsData(d); setNews(d.headlines||[]);
      const label=d._stale?"(guardadas)":d._cached?"(cache servidor)":"";
      addLog(`📰 ${d.headlines?.length||0} noticias ${label}— Sesgo: ${(d.market_bias||"neutral").toUpperCase()}`,"info");
    }catch{addLog("❌ Error al cargar noticias","sell");}
    setLoadingNews(false);
  },[addLog]);

  useEffect(()=>{loadNews(symbol);},[symbol]);

  /* ── Manual close ────────────────────────────────────────────────────── */
  const manualClose=useCallback((id)=>{
    closePosition(id,priceRef.current,"MANUAL");
  },[closePosition]);

  /* ── Stats ───────────────────────────────────────────────────────────── */
  const symPositions=positions.filter(p=>p.symbol===symbol);
  const unrealized=symPositions.reduce((s,p)=>s+posPnL(p,price,p.allocatedSize||positionSize),0);
  const totalUnrealized=positions.reduce((s,p)=>{
    const cp=livePricesRef.current[p.symbol]||price;
    return s+posPnL(p,cp,p.allocatedSize||positionSize);
  },0);
  const winCount=trades.filter(t=>t.pnl>0).length;
  const winRate=trades.length?Math.round(winCount/trades.length*100):0;
  const sigCol=aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.yellow;
  const forexMarketOpen=isForexMarketOpen(); // forex/materias — crypto siempre abierto
  const nextSec=nextAnalysis?Math.max(0,Math.round(nextAnalysis/1000)):null;

  const phaseInfo={
    idle:              {label:"INACTIVO",             color:T.muted,  desc:"Activa el modo AUTO para comenzar."},
    analyzing:         {label:"⏳ ANALIZANDO",         color:T.yellow, desc:"Consultando IA con indicadores y noticias en tiempo real..."},
    monitoring:        {label:"📡 MONITOREANDO",       color:T.accent, desc:`Vigilando ${positions.length} posición(es). TP:+${fUSD(tpTarget)} | SL:-${fUSD(slTarget)}`},
    waiting_conditions:{label:"⏸ ESPERANDO",          color:T.orange, desc:`${blockReason||"Sin condiciones favorables"} · Próximo análisis en ${nextSec??"-"}s`},
    tp_hit_analyzing:  {label:"✅ TP! RE-ANALIZANDO",  color:T.green,  desc:"Posición cerrada con ganancia. Evaluando si abrir nueva..."},
  }[autoPhase]||{label:"—",color:T.muted,desc:""};

  return(
    <>
      <style>{STYLES}</style>
      <div className="scanlines"/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",padding:"14px 20px",maxWidth:1400,margin:"0 auto"}}>

        {/* HEADER */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:9,color:T.muted,letterSpacing:4,textTransform:"uppercase",marginBottom:6}}>Robot Autónomo de Trading</div>
            {/* SELECTORS ROW — crypto dropdown + forex dropdown + scanner */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>

              {/* ── CRYPTO dropdown ── */}
              <div style={{display:"flex",alignItems:"center",gap:5,
                background:ASSETS[symbol]?.type==="crypto"?`${T.accent}10`:T.dim,
                border:`1px solid ${ASSETS[symbol]?.type==="crypto"?T.accent:T.border}`,
                borderRadius:7,padding:"4px 8px"}}>
                <span style={{fontSize:7,color:ASSETS[symbol]?.type==="crypto"?T.accent:T.muted,letterSpacing:2,fontWeight:700}}>◈ CRYPTO</span>
                <select
                  value={ASSETS[symbol]?.type==="crypto"?symbol:""}
                  onChange={e=>e.target.value&&handleSymbolChange(e.target.value)}
                  style={{
                    background:"transparent",border:"none",
                    color:ASSETS[symbol]?.type==="crypto"?T.accent:T.muted,
                    cursor:"pointer",fontSize:11,fontWeight:700,outline:"none",
                    minWidth:90,
                  }}>
                  {ASSETS[symbol]?.type!=="crypto"&&<option value="">Seleccionar...</option>}
                  {Object.entries(ASSETS).filter(([,v])=>v.type==="crypto").map(([s])=>{
                    const sig=multiMonitor?assetSignals[s]:null;
                    return(<option key={s} value={s}>{s}{sig&&sig.signal!=="—"?" · "+sig.signal:""}</option>);
                  })}
                </select>
                {ASSETS[symbol]?.type==="crypto"&&assetSignals[symbol]?.signal&&assetSignals[symbol].signal!=="—"&&(
                  <span style={{fontSize:8,fontWeight:700,color:"#04060f",
                    background:assetSignals[symbol].color||T.muted,
                    padding:"1px 5px",borderRadius:3,lineHeight:1.4}}>
                    {assetSignals[symbol].signal}
                  </span>
                )}
              </div>

              {/* ── FOREX dropdown ── */}
              <div style={{display:"flex",alignItems:"center",gap:5,
                background:ASSETS[symbol]?.type==="forex"?`${T.green}10`:T.dim,
                border:`1px solid ${ASSETS[symbol]?.type==="forex"?T.green:T.border}`,
                borderRadius:7,padding:"4px 8px"}}>
                <span style={{fontSize:7,color:ASSETS[symbol]?.type==="forex"?T.green:T.muted,letterSpacing:2,fontWeight:700}}>€ FOREX</span>
                <select
                  value={ASSETS[symbol]?.type==="forex"?symbol:""}
                  onChange={e=>e.target.value&&handleSymbolChange(e.target.value)}
                  style={{
                    background:"transparent",border:"none",
                    color:ASSETS[symbol]?.type==="forex"?T.green:T.muted,
                    cursor:"pointer",fontSize:11,fontWeight:700,outline:"none",
                    minWidth:100,
                  }}>
                  {ASSETS[symbol]?.type!=="forex"&&<option value="">Seleccionar...</option>}
                  {Object.entries(ASSETS).filter(([,v])=>v.type==="forex").map(([s])=>{
                    const w=forexWatch[s];
                    const scanSig=multiMonitor?assetSignals[s]:null;
                    const sigLabel=(scanSig?.signal&&scanSig.signal!=="—")?scanSig.signal:(w?.signal&&w.signal!=="—")?w.signal:"";
                    return(<option key={s} value={s}>{s}{sigLabel?" · "+sigLabel:""}</option>);
                  })}
                </select>
                {ASSETS[symbol]?.type==="forex"&&(()=>{
                  const w=forexWatch[symbol];
                  const sc=assetSignals[symbol];
                  const sig=sc?.signal||w?.signal;
                  const col=sc?.color||w?.color;
                  return sig&&sig!=="—"?(
                    <span style={{fontSize:8,fontWeight:700,color:"#04060f",
                      background:col||T.muted,padding:"1px 5px",borderRadius:3,lineHeight:1.4}}>
                      {sig}
                    </span>
                  ):null;
                })()}
              </div>

              {/* ── COMMODITIES dropdown ── */}
              <div style={{display:"flex",alignItems:"center",gap:5,
                background:ASSETS[symbol]?.type==="commodity"?`${T.yellow}10`:T.dim,
                border:`1px solid ${ASSETS[symbol]?.type==="commodity"?T.yellow:T.border}`,
                borderRadius:7,padding:"4px 8px"}}>
                <span style={{fontSize:7,color:ASSETS[symbol]?.type==="commodity"?T.yellow:T.muted,letterSpacing:2,fontWeight:700}}>⬡ MATERIAS</span>
                <select
                  value={ASSETS[symbol]?.type==="commodity"?symbol:""}
                  onChange={e=>e.target.value&&handleSymbolChange(e.target.value)}
                  style={{
                    background:"transparent",border:"none",
                    color:ASSETS[symbol]?.type==="commodity"?T.yellow:T.muted,
                    cursor:"pointer",fontSize:11,fontWeight:700,outline:"none",
                    minWidth:100,
                  }}>
                  {ASSETS[symbol]?.type!=="commodity"&&<option value="">Seleccionar...</option>}
                  {Object.entries(ASSETS).filter(([,v])=>v.type==="commodity").map(([s,v])=>{
                    const w=commodityWatch[s];
                    const sigLabel=w?.signal&&w.signal!=="—"?` · ${w.signal}`:"";
                    return(<option key={s} value={s}>{v.label}{sigLabel}</option>);
                  })}
                </select>
                {ASSETS[symbol]?.type==="commodity"&&(()=>{
                  const w=commodityWatch[symbol];
                  return w?.signal&&w.signal!=="—"?(
                    <span style={{fontSize:8,fontWeight:700,color:"#04060f",
                      background:w.color||T.muted,padding:"1px 5px",borderRadius:3,lineHeight:1.4}}>
                      {w.signal}
                    </span>
                  ):null;
                })()}
              </div>

              <button onClick={()=>setMultiMonitor(p=>!p)}
                style={{
                  background:multiMonitor?`${T.yellow}18`:"transparent",
                  border:`1px solid ${multiMonitor?T.yellow:T.border}`,
                  color:multiMonitor?T.yellow:T.muted,
                  borderRadius:6, padding:"5px 12px", cursor:"pointer",
                  fontSize:10, fontWeight:multiMonitor?700:400, letterSpacing:.5,
                }}>
                {multiMonitor?"📡 SCANNER ON":"📡 SCANNER"}
              </button>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginBottom:2}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:T.green,display:"inline-block",animation:"pulse 1.4s ease-in-out infinite"}}/>
              <span style={{color:T.green}}>
                {asset.type==="crypto"?"EN VIVO • BINANCE":asset.type==="commodity"?(forexLive?"EN VIVO • DERIV":"CARGANDO..."):forexLive?"EN VIVO • Forex":"CARGANDO PRECIO REAL..."}
              </span>
            </div>
            <div className="mono" style={{fontSize:26,fontWeight:700,color:T.accent}}>{fP(price,asset.precision)}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:1}}>{symbol} · Paper Trading</div>
            {/* Live floating PnL across EVERY open position, visible from any tab —
                so "¿voy ganando o perdiendo ahora mismo?" doesn't require switching
                to Operaciones Trading to find out. */}
            {positions.length>0&&(
              <div className="mono" style={{fontSize:14,fontWeight:700,marginTop:4,
                color:totalUnrealized>=0?T.green:T.red}}>
                {fUSD(totalUnrealized)} <span style={{fontSize:9,color:T.muted,fontWeight:400}}>flotante · {positions.length} abierta{positions.length!==1?"s":""}</span>
              </div>
            )}
          </div>
        </div>

        {/* FOREX WATCHLIST — always visible, 8 pairs */}
        {(()=>{
          const FOREX_SYMS=["EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/JPY","USD/CHF","USD/CAD","EUR/GBP"];
          const activeCorrs=ASSETS[symbol]?.correlations||{};
          return(
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,
              padding:"8px 14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                <span style={{fontSize:8,color:T.muted,letterSpacing:2,display:"flex",alignItems:"center",gap:8}}>
                  FOREX WATCHLIST · {FOREX_SYMS.length} pares · actualiza cada 30s · señales EMA+RSI
                  {!forexMarketOpen&&<span style={{color:T.orange,fontWeight:700,background:`${T.orange}18`,padding:"1px 7px",borderRadius:4,letterSpacing:1}}>🔒 MERCADO CERRADO — reabre domingo 22:00 UTC</span>}
                </span>
                <span style={{fontSize:8,color:T.muted}}>haz clic para abrir · correlaciones respecto al par activo</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                {FOREX_SYMS.map(sym=>{
                  const cfg=ASSETS[sym];
                  const isActive=sym===symbol;
                  // For the active forex pair use live state, otherwise use watchlist cache
                  const info=isActive&&asset.type==="forex"
                    ?{price,signal:aiResult?.signal||"—",
                      color:aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.muted,
                      rsi:Math.round(rsi),pct:0,samples:99}
                    :forexWatch[sym];
                  // Correlation context vs active pair
                  const corrDir=activeCorrs[sym];
                  const corrInfo=corrSignals[sym];
                  const hasCorr=corrDir!==undefined&&corrInfo;
                  const confirms=hasCorr&&corrInfo.confirms;
                  const borderCol=isActive?T.accent:hasCorr?(confirms?T.green:T.red):(info?.color||T.border);

                  return(
                    <div key={sym}
                      onClick={()=>handleSymbolChange(sym)}
                      style={{
                        background:isActive?`${T.accent}12`:`${borderCol}08`,
                        border:`1px solid ${borderCol}${isActive?"":"40"}`,
                        borderRadius:7,padding:"9px 11px",cursor:"pointer",
                        transition:"border-color .2s,background .2s",
                      }}>
                      {/* Header row */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:10,fontWeight:700,color:isActive?T.accent:T.text}}>{sym}</span>
                        {isActive
                          ?<span style={{fontSize:7,color:T.accent,background:`${T.accent}20`,padding:"1px 5px",borderRadius:3}}>● ACTIVO</span>
                          :hasCorr
                          ?<span style={{fontSize:7,fontWeight:700,color:confirms?T.green:T.red,
                              background:`${confirms?T.green:T.red}18`,padding:"1px 5px",borderRadius:3}}>
                              {confirms?"✓":"✗"} {corrDir>0?"CORR+":"CORR−"}
                            </span>
                          :<span style={{fontSize:7,color:T.muted,background:`${T.muted}18`,padding:"1px 5px",borderRadius:3}}>FOREX</span>
                        }
                      </div>
                      {/* Price */}
                      {info?(
                        <>
                          <div className="mono" style={{fontSize:14,fontWeight:700,
                            color:isActive?T.accent:(info.color||T.text),marginBottom:3}}>
                            {fP(info.price,cfg.precision)}
                          </div>
                          {/* Signal + RSI */}
                          <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:3}}>
                            <span style={{fontSize:8,fontWeight:700,
                              color:info.signal==="—"||info.signal==="HOLD"?T.muted:"#04060f",
                              background:info.signal==="BUY"?T.green:info.signal==="SELL"?T.red:`${T.muted}40`,
                              borderRadius:3,padding:"1px 5px"}}>
                              {info.signal}
                            </span>
                            <span style={{fontSize:8,color:T.muted}}>RSI {info.rsi}</span>
                          </div>
                          {/* Change % bar */}
                          {!isActive&&typeof info.pct==="number"&&(
                            <div style={{display:"flex",alignItems:"center",gap:4}}>
                              <div style={{flex:1,height:2,background:T.dim,borderRadius:1}}>
                                <div style={{height:"100%",
                                  width:`${Math.min(100,Math.abs(info.pct)*200)}%`,
                                  background:info.pct>=0?T.green:T.red,
                                  borderRadius:1,transition:"width .4s"}}/>
                              </div>
                              <span style={{fontSize:8,color:info.pct>=0?T.green:T.red,minWidth:38,textAlign:"right"}}>
                                {info.pct>=0?"+":""}{info.pct.toFixed(3)}%
                              </span>
                            </div>
                          )}
                          {!isActive&&info.samples<10&&(
                            <div style={{fontSize:7,color:T.orange,marginTop:2}}>⏳ {info.samples}/10 muestras</div>
                          )}
                        </>
                      ):(
                        <div style={{fontSize:9,color:T.muted,marginTop:4}}>Conectando...</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* COMMODITIES WATCHLIST — always visible, 3 instrumentos */}
        {(()=>{
          const COMMODITY_SYMS=["XAU/USD","XAG/USD","XTI/USD"];
          const COMMODITY_LABELS={"XAU/USD":"⬡ ORO","XAG/USD":"⬡ PLATA","XTI/USD":"⬡ PETRÓLEO"};
          return(
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,
              padding:"8px 14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                <span style={{fontSize:8,color:T.muted,letterSpacing:2,display:"flex",alignItems:"center",gap:8}}>
                  MATERIAS PRIMAS · ORO · PLATA · PETRÓLEO · Deriv en vivo · actualiza cada 20s
                  {!forexMarketOpen&&<span style={{color:T.orange,fontWeight:700,background:`${T.orange}18`,padding:"1px 7px",borderRadius:4,letterSpacing:1}}>🔒 MERCADO CERRADO — reabre domingo 22:00 UTC</span>}
                </span>
                <span style={{fontSize:8,color:T.muted}}>haz clic para abrir gráfica</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                {COMMODITY_SYMS.map(sym=>{
                  const cfg=ASSETS[sym];
                  const isActive=sym===symbol;
                  const info=isActive&&asset.type==="commodity"
                    ?{price,signal:aiResult?.signal||"—",
                      color:aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.muted,
                      rsi:Math.round(rsi),pct:0,samples:99}
                    :commodityWatch[sym];
                  const borderCol=isActive?T.yellow:(info?.color||T.border);
                  return(
                    <div key={sym}
                      onClick={()=>handleSymbolChange(sym)}
                      style={{
                        background:isActive?`${T.yellow}12`:`${borderCol}08`,
                        border:`1px solid ${borderCol}${isActive?"":"40"}`,
                        borderRadius:7,padding:"9px 11px",cursor:"pointer",
                        transition:"border-color .2s,background .2s",
                      }}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:10,fontWeight:700,color:isActive?T.yellow:T.text}}>{COMMODITY_LABELS[sym]}</span>
                        {isActive
                          ?<span style={{fontSize:7,color:T.yellow,background:`${T.yellow}20`,padding:"1px 5px",borderRadius:3}}>● ACTIVO</span>
                          :<span style={{fontSize:7,color:T.muted,background:`${T.muted}18`,padding:"1px 5px",borderRadius:3}}>COMMOD.</span>
                        }
                      </div>
                      {info?(
                        <>
                          <div className="mono" style={{fontSize:14,fontWeight:700,
                            color:isActive?T.yellow:(info.color||T.text),marginBottom:3}}>
                            {fP(info.price,cfg.precision)}
                          </div>
                          <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:3}}>
                            <span style={{fontSize:8,fontWeight:700,
                              color:info.signal==="—"||info.signal==="HOLD"?T.muted:"#04060f",
                              background:info.signal==="BUY"?T.green:info.signal==="SELL"?T.red:`${T.muted}40`,
                              borderRadius:3,padding:"1px 5px"}}>
                              {info.signal}
                            </span>
                            <span style={{fontSize:8,color:T.muted}}>RSI {info.rsi}</span>
                          </div>
                          {!isActive&&typeof info.pct==="number"&&(
                            <div style={{display:"flex",alignItems:"center",gap:4}}>
                              <div style={{flex:1,height:2,background:T.dim,borderRadius:1}}>
                                <div style={{height:"100%",
                                  width:`${Math.min(100,Math.abs(info.pct)*200)}%`,
                                  background:info.pct>=0?T.green:T.red,
                                  borderRadius:1,transition:"width .4s"}}/>
                              </div>
                              <span style={{fontSize:8,color:info.pct>=0?T.green:T.red,minWidth:38,textAlign:"right"}}>
                                {info.pct>=0?"+":""}{info.pct.toFixed(3)}%
                              </span>
                            </div>
                          )}
                          {!isActive&&info.samples<10&&(
                            <div style={{fontSize:7,color:T.orange,marginTop:2}}>⏳ {info.samples}/10 muestras</div>
                          )}
                        </>
                      ):(
                        <div style={{fontSize:9,color:T.muted,marginTop:4}}>Conectando...</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* NEWS TICKER */}
        {news.length>0&&<div style={{marginBottom:10}}><Ticker headlines={news}/></div>}

        {/* MULTI-ASSET SCANNER PANEL */}
        {multiMonitor&&Object.keys(assetSignals).length>0&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"8px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
              <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>SCANNER MULTI-ACTIVO · actualiza cada 10s · señales EMA+RSI</span>
              <div style={{display:"flex",gap:8,fontSize:8,color:T.muted}}>
                <span>◈ {Object.values(ASSETS).filter(a=>a.type==="crypto").length} crypto</span>
                <span>€ {Object.values(ASSETS).filter(a=>a.type==="forex").length} forex</span>
                <span>⬡ {Object.values(ASSETS).filter(a=>a.type==="commodity").length} materias</span>
              </div>
            </div>
            {/* Crypto section */}
            <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>CRYPTO</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:8}}>
              {Object.entries(ASSETS).filter(([,cfg])=>cfg.type==="crypto").map(([sym,cfg])=>{
                const isActive=sym===symbol;
                const sig=isActive?{
                  price,signal:aiResult?.signal||"—",
                  color:aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.muted,
                  rsi:rsi.toFixed(0),pct:((price-cfg.basePrice)/cfg.basePrice*100),
                }:assetSignals[sym];
                if(!sig)return(<div key={sym} style={{background:T.dim,borderRadius:6,padding:"8px",textAlign:"center",opacity:.4}}><div style={{fontSize:8,color:T.muted}}>{sym}</div><div style={{fontSize:9,color:T.muted}}>cargando…</div></div>);
                const col=sig.color||T.muted;
                return(
                  <div key={sym} onClick={()=>!isActive&&handleSymbolChange(sym)}
                    style={{background:isActive?`${T.accent}12`:`${col}08`,border:`1px solid ${isActive?T.accent:col}40`,
                      borderRadius:6,padding:"8px 10px",cursor:isActive?"default":"pointer",transition:"all .2s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <span style={{fontSize:9,color:isActive?T.accent:T.text,fontWeight:700}}>◈ {sym}</span>
                      {isActive&&<span style={{fontSize:7,color:T.accent,background:`${T.accent}20`,padding:"1px 5px",borderRadius:3}}>ACTIVO</span>}
                    </div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:col,marginBottom:2}}>{fP(sig.price,cfg.precision)}</div>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      <span style={{fontSize:8,fontWeight:700,color:"#04060f",background:col,borderRadius:3,padding:"1px 5px"}}>{sig.signal}</span>
                      <span style={{fontSize:8,color:T.muted}}>RSI {sig.rsi}</span>
                      {sig.pct!=null&&<span style={{fontSize:8,color:sig.pct>=0?T.green:T.red,marginLeft:"auto"}}>{sig.pct>=0?"+":""}{sig.pct?.toFixed(2)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Forex section */}
            <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>FOREX</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {Object.entries(ASSETS).filter(([,cfg])=>cfg.type==="forex").map(([sym,cfg])=>{
                const isActive=sym===symbol;
                const sig=isActive?{
                  price,signal:aiResult?.signal||"—",
                  color:aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.muted,
                  rsi:rsi.toFixed(0),pct:0,
                }:assetSignals[sym];
                if(!sig)return(<div key={sym} style={{background:T.dim,borderRadius:6,padding:"8px",textAlign:"center",opacity:.4}}><div style={{fontSize:8,color:T.muted}}>{sym}</div><div style={{fontSize:9,color:T.muted}}>cargando…</div></div>);
                const col=sig.color||T.muted;
                const corrDir=ASSETS[symbol]?.correlations?.[sym];
                const corrInfo=corrSignals[sym];
                const hasCorrBadge=corrDir!==undefined&&corrInfo;
                return(
                  <div key={sym} onClick={()=>!isActive&&handleSymbolChange(sym)}
                    style={{background:isActive?`${T.accent}12`:`${col}08`,border:`1px solid ${isActive?T.accent:col}40`,
                      borderRadius:6,padding:"8px 10px",cursor:isActive?"default":"pointer",transition:"all .2s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <span style={{fontSize:9,color:isActive?T.accent:T.text,fontWeight:700}}>{sym}</span>
                      {isActive
                        ?<span style={{fontSize:7,color:T.accent,background:`${T.accent}20`,padding:"1px 5px",borderRadius:3}}>ACTIVO</span>
                        :hasCorrBadge&&<span style={{fontSize:7,fontWeight:700,
                          color:corrInfo.confirms?T.green:T.red,
                          background:`${corrInfo.confirms?T.green:T.red}18`,padding:"1px 4px",borderRadius:3}}>
                          {corrDir>0?"↑↑":"↓↑"}
                        </span>
                      }
                    </div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:col,marginBottom:2}}>
                      {fP(sig.price,cfg.precision)}
                    </div>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      <span style={{fontSize:8,fontWeight:700,color:"#04060f",
                        background:col,borderRadius:3,padding:"1px 5px"}}>{sig.signal}</span>
                      <span style={{fontSize:8,color:T.muted}}>RSI {sig.rsi}</span>
                      {sig.pct!=null&&(
                        <span style={{fontSize:8,color:sig.pct>=0?T.green:T.red,marginLeft:"auto"}}>
                          {sig.pct>=0?"+":""}{sig.pct?.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Commodities section */}
            <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>MATERIAS PRIMAS</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
              {Object.entries(ASSETS).filter(([,cfg])=>cfg.type==="commodity").map(([sym,cfg])=>{
                const isActive=sym===symbol;
                const w=isActive&&asset.type==="commodity"
                  ?{price,signal:aiResult?.signal||"—",
                    color:aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.muted,
                    rsi:Math.round(rsi),pct:0}
                  :commodityWatch[sym];
                const col=w?.color||T.yellow;
                return(
                  <div key={sym} onClick={()=>!isActive&&handleSymbolChange(sym)}
                    style={{background:isActive?`${T.yellow}12`:`${col}08`,border:`1px solid ${isActive?T.yellow:col}40`,
                      borderRadius:6,padding:"8px 10px",cursor:isActive?"default":"pointer",transition:"all .2s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <span style={{fontSize:9,color:isActive?T.yellow:T.text,fontWeight:700}}>⬡ {cfg.label}</span>
                      {isActive&&<span style={{fontSize:7,color:T.yellow,background:`${T.yellow}20`,padding:"1px 5px",borderRadius:3}}>ACTIVO</span>}
                    </div>
                    {w?(
                      <>
                        <div className="mono" style={{fontSize:12,fontWeight:700,color:isActive?T.yellow:col,marginBottom:2}}>
                          {fP(w.price,cfg.precision)}
                        </div>
                        <div style={{display:"flex",gap:5,alignItems:"center"}}>
                          <span style={{fontSize:8,fontWeight:700,color:"#04060f",background:col,borderRadius:3,padding:"1px 5px"}}>{w.signal}</span>
                          <span style={{fontSize:8,color:T.muted}}>RSI {w.rsi}</span>
                          {w.pct!=null&&<span style={{fontSize:8,color:w.pct>=0?T.green:T.red,marginLeft:"auto"}}>{w.pct>=0?"+":""}{w.pct?.toFixed(2)}%</span>}
                        </div>
                      </>
                    ):<div style={{fontSize:9,color:T.muted,marginTop:4}}>Cargando...</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── NAVIGATION ── */}
        <div style={{display:"flex",gap:0,marginBottom:12,borderBottom:`1px solid ${T.border}`,paddingBottom:0}}>
          {[
            {id:"dashboard", label:"📊 Dashboard"},
            {id:"signals", label:"🔍 Señales"},
            {id:"trading", label:`💼 Operaciones Trading${positions.length>0?` (${positions.length})`:""}`,
              badge:positions.length},
          ].map(tab=>(
            <button key={tab.id} onClick={()=>setActiveView(tab.id)}
              style={{
                background:"transparent",
                border:"none",
                borderBottom:`2px solid ${activeView===tab.id?T.accent:"transparent"}`,
                color:activeView===tab.id?T.accent:T.muted,
                padding:"8px 20px",cursor:"pointer",
                fontSize:12,fontWeight:activeView===tab.id?700:400,letterSpacing:.5,
                transition:"all .15s",
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════ VISTA: SEÑALES — SEÑALES FOREX ══════════ */}
        {activeView==="signals"&&(()=>{
          const FOREX_PAIRS=["EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/JPY","USD/CHF","USD/CAD","EUR/GBP"];
          const COMMODITY_PAIRS=["XAU/USD","XAG/USD","XTI/USD"];
          const uniquePairs=[...new Set(FOREX_PAIRS)];

          // Build precise signal data for the ACTIVE symbol using real chart indicators
          // Returns null when no AI analysis has run yet → watchlist data used as fallback
          const buildActiveData=(sym)=>{
            if(sym!==symbol) return null;
            if(!aiResult) return null; // no analysis yet — avoid showing 0% confidence
            const cfg=ASSETS[sym];
            const prec=cfg.precision;
            const emaSignal=ema9>ema21?"BUY":ema9<ema21?"SELL":"HOLD";
            const sig=aiResult?.signal||emaSignal;
            const conf=aiResult?.confidence||0;
            const col=sig==="BUY"?T.green:sig==="SELL"?T.red:T.muted;
            const isBuy=sig==="BUY";
            let target,stop;
            if(activePrediction?.symbol===sym&&activePrediction.signal===sig){
              target=activePrediction.targetPrice;
              stop=activePrediction.stopPrice;
            } else {
              const recentC=candles.slice(-14);
              const atr=recentC.length>0?recentC.reduce((s,c)=>s+(c.h-c.l),0)/recentC.length:price*0.001;
              target=isBuy?price+atr*2.5:price-atr*2.5;
              stop=isBuy?price-atr*1.5:price+atr*1.5;
            }
            const pipSz=Math.pow(10,-prec);
            const targetPips=Math.abs(target-price)/pipSz;
            const stopPips=Math.abs(stop-price)/pipSz;
            const rr=stopPips>0?(targetPips/stopPips).toFixed(1):"—";
            return{price,signal:sig,color:col,rsi:Math.round(rsi),confidence:conf,prec,
              entry:price,target,stop,targetPips:targetPips.toFixed(1),stopPips:stopPips.toFixed(1),
              rr,samples:candles.length,pct:0};
          };

          const buySignals=uniquePairs.filter(s=>s===symbol?(aiResult?.signal==="BUY"):forexWatch[s]?.signal==="BUY");
          const sellSignals=uniquePairs.filter(s=>s===symbol?(aiResult?.signal==="SELL"):forexWatch[s]?.signal==="SELL");
          const commBuy=COMMODITY_PAIRS.filter(s=>s===symbol?(aiResult?.signal==="BUY"):commodityWatch[s]?.signal==="BUY");
          const commSell=COMMODITY_PAIRS.filter(s=>s===symbol?(aiResult?.signal==="SELL"):commodityWatch[s]?.signal==="SELL");

          // Distribution + best-opportunity across every watched pair (for the sidebar)
          const allSyms=[...uniquePairs,...COMMODITY_PAIRS];
          const allData=allSyms.map(s=>({sym:s,d:buildActiveData(s)||forexWatch[s]||commodityWatch[s]})).filter(x=>x.d);
          const totalBuy=buySignals.length+commBuy.length;
          const totalSell=sellSignals.length+commSell.length;
          const totalHold=Math.max(0,allSyms.length-totalBuy-totalSell);
          const best=allData.filter(x=>x.d.signal!=="HOLD").sort((a,b)=>(b.d.confidence||0)-(a.d.confidence||0))[0];

          return(
            <div style={{animation:"fadeUp .3s ease",display:"grid",gridTemplateColumns:"1fr 360px",gap:16,alignItems:"start"}}>
            <div style={{minWidth:0}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontSize:18,fontWeight:700,color:T.accent,letterSpacing:1}}>SEÑALES DE APERTURA</div>
                  <div style={{fontSize:9,color:T.muted,marginTop:2}}>
                    Todos los pares forex · actualiza cada 15s · señales EMA+RSI · haz clic en un par para ver su gráfica
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{background:`${T.green}18`,border:`1px solid ${T.green}40`,borderRadius:6,padding:"5px 12px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:2}}>COMPRA</div>
                    <div style={{fontSize:18,fontWeight:700,color:T.green}}>{buySignals.length}</div>
                  </div>
                  <div style={{background:`${T.red}18`,border:`1px solid ${T.red}40`,borderRadius:6,padding:"5px 12px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:2}}>VENTA</div>
                    <div style={{fontSize:18,fontWeight:700,color:T.red}}>{sellSignals.length}</div>
                  </div>
                </div>
              </div>

              {/* Table header */}
              <div style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                gap:6,padding:"5px 10px",marginBottom:4,borderBottom:`1px solid ${T.border}40`}}>
                {["PAR","TENDENCIA","SEÑAL","CONF.","ENTRADA","RANGO STOP · OBJETIVO","PIPS","R/R"].map(h=>(
                  <div key={h} style={{fontSize:7,color:T.muted,letterSpacing:1.5,fontWeight:700}}>{h}</div>
                ))}
              </div>

              {/* Rows */}
              {uniquePairs.map(sym=>{
                const d=buildActiveData(sym)||forexWatch[sym];
                if(!d)return(
                  <div key={sym} style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                    gap:6,padding:"10px",marginBottom:3,borderRadius:6,background:T.card,
                    border:`1px solid ${T.border}`,alignItems:"center"}}>
                    <span style={{fontSize:11,fontWeight:700,color:T.accent}}>{sym}</span>
                    <span style={{fontSize:9,color:T.muted}}>Cargando...</span>
                    <span/><span/><span/><span/><span/><span/>
                  </div>
                );
                const isBuy=d.signal==="BUY";
                const isHold=d.signal==="HOLD";
                const col=d.color;
                const prec=d.prec||5;
                const confBar=Math.min(100,d.confidence||0);
                return(
                  <div key={sym} className="fade-up"
                    onClick={()=>{handleSymbolChange(sym);setActiveView("dashboard");}}
                    style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                      gap:6,padding:"10px",marginBottom:4,borderRadius:7,cursor:"pointer",
                      background:isHold?T.card:`${col}08`,
                      border:`1px solid ${isHold?T.border:col+"35"}`,
                      alignItems:"center",transition:"filter .15s"}}
                  >
                    {/* Par */}
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <span style={{fontSize:12,fontWeight:700,color:sym===symbol?T.yellow:T.accent}}>{sym}</span>
                        {sym===symbol&&<span style={{fontSize:6,color:T.yellow,background:`${T.yellow}25`,padding:"1px 4px",borderRadius:3,letterSpacing:1}}>ACTIVO</span>}
                      </div>
                      <div style={{marginTop:2}}><TierBadge symbol={sym}/></div>
                    </div>

                    {/* Sparkline */}
                    <Sparkline data={d.sparkline} color={isHold?T.muted:col}/>

                    {/* Señal */}
                    <div style={{background:`${col}20`,border:`1px solid ${col}50`,borderRadius:5,
                      padding:"4px 8px",textAlign:"center"}}>
                      <div style={{fontSize:11,fontWeight:700,color:col}}>
                        {isHold?"— HOLD":isBuy?"▲ BUY":"▼ SELL"}
                      </div>
                    </div>

                    {/* Confianza */}
                    <div>
                      <div className="mono" style={{fontSize:12,fontWeight:700,color:isHold?T.muted:col}}>
                        {isHold?"—":`${d.confidence}%`}
                      </div>
                      {!isHold&&(
                        <div style={{height:3,background:T.dim,borderRadius:2,marginTop:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${confBar}%`,background:col,borderRadius:2}}/>
                        </div>
                      )}
                    </div>

                    {/* Entrada */}
                    <div className="mono" style={{fontSize:11,fontWeight:700,color:T.text}}>
                      {d.price.toFixed(prec)}
                    </div>

                    {/* Rango stop/objetivo */}
                    <RangeBar entry={d.price} target={d.target} stop={d.stop} isHold={isHold} precision={prec}/>

                    {/* Pips al objetivo */}
                    <div className="mono" style={{fontSize:11,fontWeight:700,color:isHold?T.muted:T.yellow}}>
                      {isHold?"—":`${d.targetPips}p`}
                    </div>

                    {/* R/R */}
                    <div className="mono" style={{fontSize:11,fontWeight:700,
                      color:isHold?T.muted:parseFloat(d.rr)>=1.5?T.green:T.yellow}}>
                      {isHold?"—":`1:${d.rr}`}
                    </div>
                  </div>
                );
              })}

              {/* ── MATERIAS PRIMAS section ── */}
              <div style={{marginTop:16,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:T.yellow,letterSpacing:1}}>⬡ MATERIAS PRIMAS</div>
                  <div style={{fontSize:9,color:T.muted,marginTop:2}}>ORO · PLATA · PETRÓLEO WTI · Deriv en vivo · señales EMA+RSI</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{background:`${T.green}18`,border:`1px solid ${T.green}40`,borderRadius:6,padding:"5px 12px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:2}}>COMPRA</div>
                    <div style={{fontSize:18,fontWeight:700,color:T.green}}>{commBuy.length}</div>
                  </div>
                  <div style={{background:`${T.red}18`,border:`1px solid ${T.red}40`,borderRadius:6,padding:"5px 12px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:2}}>VENTA</div>
                    <div style={{fontSize:18,fontWeight:700,color:T.red}}>{commSell.length}</div>
                  </div>
                </div>
              </div>
              {COMMODITY_PAIRS.map(sym=>{
                const cfg=ASSETS[sym];
                const d=buildActiveData(sym)||commodityWatch[sym];
                if(!d)return(
                  <div key={sym} style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                    gap:6,padding:"10px",marginBottom:3,borderRadius:6,background:T.card,
                    border:`1px solid ${T.border}`,alignItems:"center"}}>
                    <span style={{fontSize:11,fontWeight:700,color:T.yellow}}>⬡ {cfg.label}</span>
                    <span style={{fontSize:9,color:T.muted}}>Cargando...</span>
                    <span/><span/><span/><span/><span/><span/>
                  </div>
                );
                const isBuy=d.signal==="BUY";
                const isHold=d.signal==="HOLD";
                const col=d.color;
                const prec=d.prec||cfg.precision;
                const confBar=Math.min(100,d.confidence||0);
                return(
                  <div key={sym} className="fade-up"
                    onClick={()=>{handleSymbolChange(sym);setActiveView("dashboard");}}
                    style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                      gap:6,padding:"10px",marginBottom:4,borderRadius:7,cursor:"pointer",
                      background:isHold?T.card:`${col}08`,
                      border:`1px solid ${isHold?T.border:col+"35"}`,
                      alignItems:"center",transition:"filter .15s"}}
                  >
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:T.yellow}}>⬡ {cfg.label}</div>
                      <div style={{marginTop:2}}><TierBadge symbol={sym}/></div>
                    </div>
                    <Sparkline data={d.sparkline} color={isHold?T.muted:col}/>
                    <div style={{background:`${col}20`,border:`1px solid ${col}50`,borderRadius:5,padding:"4px 8px",textAlign:"center"}}>
                      <div style={{fontSize:11,fontWeight:700,color:col}}>{isHold?"— HOLD":isBuy?"▲ BUY":"▼ SELL"}</div>
                    </div>
                    <div>
                      <div className="mono" style={{fontSize:12,fontWeight:700,color:isHold?T.muted:col}}>
                        {isHold?"—":`${d.confidence}%`}
                      </div>
                      {!isHold&&(
                        <div style={{height:3,background:T.dim,borderRadius:2,marginTop:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${confBar}%`,background:col,borderRadius:2}}/>
                        </div>
                      )}
                    </div>
                    <div className="mono" style={{fontSize:11,fontWeight:700,color:T.text}}>{d.price.toFixed(prec)}</div>
                    <RangeBar entry={d.price} target={d.target} stop={d.stop} isHold={isHold} precision={prec}/>
                    <div className="mono" style={{fontSize:11,fontWeight:700,color:isHold?T.muted:T.yellow}}>
                      {isHold?"—":`${d.targetPips}p`}
                    </div>
                    <div className="mono" style={{fontSize:11,fontWeight:700,
                      color:isHold?T.muted:parseFloat(d.rr)>=1.5?T.green:T.yellow}}>
                      {isHold?"—":`1:${d.rr}`}
                    </div>
                  </div>
                );
              })}

              <div style={{marginTop:12,padding:"8px 12px",background:T.card,borderRadius:6,
                border:`1px solid ${T.border}`,fontSize:9,color:T.muted,lineHeight:1.6}}>
                <strong style={{color:T.accent}}>Cómo usar estas señales:</strong> Haz clic en cualquier par para abrir su gráfica con la proyección detallada.
                Los niveles de Objetivo y Stop se calculan con la volatilidad reciente (ATR estimado).
                Señales generadas con EMA9/EMA21 + RSI(14). Esta vista es una guía para operar manualmente en cualquier par, incluidos los marcados 🔒 SIN-EDGE:
                el bot solo bloquea la apertura automática en esos pares, no la información. Actualiza cada 15s · materias primas cada 20s.
              </div>
            </div>{/* end left column */}

            <div style={{minWidth:0}}>
              <SignalDistribution buy={totalBuy} sell={totalSell} hold={totalHold}/>
              <TierLegend/>
              {best&&(
                <div style={{background:`linear-gradient(180deg,${best.d.signal==="BUY"?T.green:T.red}0f,transparent 60%),${T.panel}`,
                  border:`1px solid ${best.d.signal==="BUY"?T.green:T.red}40`,borderRadius:8,padding:"14px 16px"}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:10}}>MEJOR OPORTUNIDAD ACTUAL</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontSize:15,fontWeight:700,color:T.text}}>{best.sym}</span>
                    <span style={{fontSize:9,fontWeight:700,color:"#04060f",
                      background:best.d.signal==="BUY"?T.green:T.red,padding:"3px 9px",borderRadius:4}}>
                      {best.d.signal==="BUY"?"▲":"▼"} {best.d.signal} {best.d.confidence}%
                    </span>
                  </div>
                  <div style={{fontSize:9,color:T.muted,lineHeight:1.5}}>
                    R:R 1:{best.d.rr} · {best.d.targetPips} pips al objetivo
                    {SYMBOL_STRATEGY[best.sym]&&SYMBOL_STRATEGY[best.sym].tier!=="ROBUSTO"&&(
                      <> · tier <b style={{color:SYMBOL_STRATEGY[best.sym].tier==="SIN-EDGE"?T.red:T.yellow}}>{SYMBOL_STRATEGY[best.sym].tier}</b> — opera manual con precaución.</>
                    )}
                  </div>
                </div>
              )}
            </div>{/* end right column */}
            </div>
          );
        })()}

        {/* ══════════ VISTA: OPERACIONES TRADING — abiertas en vivo + histórico ══════════ */}
        {activeView==="trading"&&(()=>{
          const closedWins=trades.filter(t=>t.pnl>0).length;
          const closedLosses=trades.filter(t=>t.pnl<=0).length;
          const totalClosedPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
          return(
            <div style={{animation:"fadeUp .3s ease"}}>

              {/* Resumen */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>ABIERTAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.accent}}>{positions.length}</div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>CERRADAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.text}}>{trades.length}</div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${T.green}30`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>GANADAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.green}}>{closedWins}</div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${T.red}30`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>PERDIDAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.red}}>{closedLosses}</div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${totalClosedPnl>=0?T.green:T.red}30`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>P&amp;L CERRADO</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:totalClosedPnl>=0?T.green:T.red}}>{fUSD(totalClosedPnl)}</div>
                </div>
              </div>

              {/* Abiertas en vivo */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:14,fontWeight:700,color:T.accent,letterSpacing:1,marginBottom:10}}>POSICIONES ABIERTAS EN VIVO</div>
                {positions.length===0?(
                  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"20px",textAlign:"center",fontSize:11,color:T.muted}}>
                    Sin posiciones abiertas ahora mismo.
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{display:"grid",gridTemplateColumns:"110px 70px 90px 90px 70px 100px 100px 100px 90px 70px",
                      gap:10,padding:"0 14px 6px",fontSize:10,color:T.text,letterSpacing:1.5,fontWeight:700}}>
                      <div>PAR</div><div>TIPO</div><div>ENTRADA</div><div>ACTUAL</div><div>%</div>
                      <div>OBJETIVO</div><div>STOP</div><div>PNL</div><div>ESTADO</div><div></div>
                    </div>
                    {positions.map(pos=>{
                      const posSym=pos.symbol||symbol;
                      const cfg=ASSETS[posSym];
                      const prec=cfg?.precision||5;
                      const livePrice=posSym===symbol?price:(livePrices[posSym]??cfg?.basePrice);
                      const ps=pos.allocatedSize||positionSize;
                      const mult=pos.multiplier||multiplier;
                      const pnl=posPnL(pos,livePrice,ps);
                      const isBuy=pos.type==="BUY";
                      const dir=isBuy?1:-1;
                      const col=pnl>=0?T.green:T.red;
                      const dirCol=isBuy?T.green:T.red; // fixed by direction — never confuse with col (win/loss)
                      const pctChange=dir*(livePrice-pos.entry)/pos.entry*100;
                      const elapsedMin=Math.floor((Date.now()-(pos.openTime||Date.now()))/60000);
                      const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
                      const peakPnl=Math.max(pos.peakPnl||0,pnl);
                      const isProtected=peakPnl>=posTp*TRAIL_BREAKEVEN_AT;
                      const floorUsd=isProtected?Math.max(0,peakPnl*(1-TRAIL_GIVEBACK)):null;
                      // Convert the $ TP/SL (or the locked-in floor) into the actual
                      // price this symbol needs to reach — inverse of posPnL().
                      const priceFor=usd=>pos.entry*(1+dir*usd/(ps*mult));
                      const tpPrice=priceFor(posTp);
                      const stopPrice=isProtected?priceFor(floorUsd):priceFor(-posSl);
                      return(
                        <div key={pos.id} className="fade-up" style={{display:"grid",gridTemplateColumns:"110px 70px 90px 90px 70px 100px 100px 100px 90px 70px",
                          gap:10,alignItems:"center",background:`${col}08`,border:`1px solid ${col}35`,borderRadius:8,padding:"10px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:12,fontWeight:700,color:T.text}}>{posSym}</span>
                            {pos.derivContractId&&<span style={{fontSize:6,color:T.accent,background:`${T.accent}18`,padding:"1px 4px",borderRadius:3}}>DERIV</span>}
                          </div>
                          <span style={{fontSize:10,fontWeight:700,color:dirCol}}>{isBuy?"▲ BUY":"▼ SELL"}</span>
                          <span className="mono" style={{fontSize:11,color:T.muted}}>{fP(pos.entry,prec)}</span>
                          <span className="mono" style={{fontSize:11,color:T.text}}>{fP(livePrice,prec)}</span>
                          <span className="mono" style={{fontSize:11,fontWeight:700,color:col}}>{fPct(pctChange)}</span>
                          <div>
                            <div className="mono" style={{fontSize:12,fontWeight:700,color:T.green}}>{fP(tpPrice,prec)}</div>
                            <div style={{fontSize:7,color:T.green,opacity:.75}}>+{fUSD(posTp,false)}</div>
                          </div>
                          <div>
                            <div className="mono" style={{fontSize:12,fontWeight:700,color:isProtected?T.green:T.red}}>{fP(stopPrice,prec)}</div>
                            <div style={{fontSize:7,color:isProtected?T.green:T.red,opacity:.75}}>{isProtected?`≥${fUSD(floorUsd,false)}`:`-${fUSD(posSl,false)}`}</div>
                          </div>
                          <span className="mono" style={{fontSize:14,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
                          <span style={{fontSize:9,fontWeight:700,color:isProtected?T.green:T.muted,
                            background:isProtected?`${T.green}18`:"transparent",padding:isProtected?"3px 7px":0,borderRadius:4}}>
                            {isProtected?"🔒 protegida":`hace ${elapsedMin}m`}
                          </span>
                          <button onClick={()=>closePosition(pos.id,livePrice,"MANUAL")}
                            style={{background:"transparent",border:`1px solid ${T.muted}50`,color:T.muted,borderRadius:5,padding:"5px 10px",cursor:"pointer",fontSize:10,fontWeight:700}}>
                            Cerrar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Histórico de cerradas */}
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.text,letterSpacing:1,marginBottom:10}}>HISTÓRICO — GANANCIAS Y PÉRDIDAS</div>
                {trades.length===0?(
                  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"20px",textAlign:"center",fontSize:11,color:T.muted}}>
                    Sin operaciones cerradas todavía.
                  </div>
                ):(
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"110px 90px 70px 90px 90px 90px 90px 1fr",gap:10,padding:"0 14px 6px",fontSize:7,color:T.muted,letterSpacing:1.5,fontWeight:700}}>
                      <div>FECHA</div><div>PAR</div><div>TIPO</div><div>ENTRADA</div><div>SALIDA</div><div>PNL</div><div>MOTIVO</div><div>PATRONES</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {trades.slice(0,50).map((t,i)=>{
                        const prec=ASSETS[t.symbol]?.precision||5;
                        const win=t.pnl>0;
                        const col=win?T.green:T.red;
                        return(
                          <div key={i} style={{display:"grid",gridTemplateColumns:"110px 90px 70px 90px 90px 90px 90px 1fr",
                            gap:10,alignItems:"center",background:T.card,border:`1px solid ${col}25`,borderRadius:7,padding:"9px 14px"}}>
                            <span className="mono" style={{fontSize:9,color:T.muted}}>{t.time||"—"}</span>
                            <span style={{fontSize:10,fontWeight:700,color:T.text}}>{t.symbol||symbol}</span>
                            <span style={{fontSize:9,fontWeight:700,color:t.type==="BUY"?T.green:T.red}}>{t.type}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(t.entry,prec)}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(t.exit,prec)}</span>
                            <span className="mono" style={{fontSize:11,fontWeight:700,color:col}}>{fUSD(t.pnl)}</span>
                            <span style={{fontSize:8,fontWeight:700,color:col,background:`${col}18`,padding:"2px 7px",borderRadius:4,textAlign:"center"}}>{t.reason||"—"}</span>
                            <span style={{fontSize:9,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {(t.activePatterns||[]).join(", ")||"—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ══════════ VISTA: DASHBOARD ══════════ */}
        {activeView==="dashboard"&&(<>

        <div style={{display:"grid",gridTemplateColumns:"1fr 380px",gap:16,alignItems:"start"}}>
        <div style={{minWidth:0}}>

        {/* SIGNAL HERO — la señal activa es lo primero que se ve en el Dashboard */}
        {aiResult&&(
          <div className="fade-up" style={{background:`linear-gradient(180deg,${T.panel},${T.card})`,border:`1px solid ${sigCol}40`,borderRadius:10,padding:"18px 20px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:220}}>
                <div style={{fontSize:8,color:T.muted,letterSpacing:3,marginBottom:5}}>SEÑAL ACTIVA · {symbol}</div>
                <div style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap"}}>
                  <div style={{fontSize:42,fontWeight:900,letterSpacing:2,color:sigCol,lineHeight:1}}>{aiResult.signal}</div>
                  <div style={{display:"flex",flexDirection:"column"}}>
                    <span style={{fontSize:8,color:T.muted,letterSpacing:1}}>CONFIANZA</span>
                    <span className="mono" style={{fontSize:20,fontWeight:700,color:sigCol}}>{aiResult.confidence}%</span>
                  </div>
                </div>
                <div style={{fontSize:11,color:T.muted,marginTop:8}}>
                  Riesgo <span style={{color:aiResult.risk==="BAJO"?T.green:aiResult.risk==="ALTO"?T.red:T.yellow}}>{aiResult.risk}</span>
                  {" "}· Noticias <span style={{color:aiResult.news_impact==="BULLISH"?T.green:aiResult.news_impact==="BEARISH"?T.red:T.muted}}>{aiResult.news_impact}</span>
                  {" "}· <span style={{color:aiResult.should_open&&aiResult.confidence>=dynamicMinConf?T.green:T.orange}}>
                    {aiResult.should_open&&aiResult.confidence>=dynamicMinConf
                      ?`ABRIR ✓ (≥${dynamicMinConf}%)`
                      :aiResult.should_open
                        ?`🔒 UMBRAL ${dynamicMinConf}% (${aiResult.confidence}%)`
                        :"NO ABRIR"
                    }
                  </span>
                </div>
                <div style={{background:T.dim,borderRadius:5,padding:"9px 12px",fontSize:11,color:T.text,lineHeight:1.65,borderLeft:`3px solid ${sigCol}`,marginTop:10}}>
                  {aiResult.reasoning}
                </div>
                {!autoMode&&aiResult.signal!=="HOLD"&&positions.filter(p=>!p.symbol||p.symbol===symbol).length<MAX_POSITIONS&&(
                  <button onClick={()=>{
                    const manualScaled=scaledTpSl(symbol,positionSizeRef.current,multiplierRef.current);
                    const pos={type:aiResult.signal,entry:priceRef.current,id:Date.now(),symbol,openTime:Date.now(),
                      allocatedSize:positionSizeRef.current,multiplier:multiplierRef.current,peakPnl:0,
                      tp:manualScaled?.tp??tpTargetRef.current, sl:manualScaled?.sl??slTargetRef.current};
                    setPositions(p=>[...p,pos]);
                    savePositionOpen(pos,aiResult.confidence);
                    addLog(`${aiResult.signal==="BUY"?"🟢":"🔴"} ${aiResult.signal} manual @ ${fP(priceRef.current,asset.precision)}`,aiResult.signal==="BUY"?"buy":"sell");
                  }} style={{marginTop:10,width:"100%",background:`${sigCol}18`,border:`1px solid ${sigCol}`,
                    color:sigCol,borderRadius:7,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,letterSpacing:1}}>
                    ▶ EJECUTAR {aiResult.signal} MANUALMENTE (pos {positions.filter(p=>!p.symbol||p.symbol===symbol).length+1}/{MAX_POSITIONS})
                  </button>
                )}
              </div>

              <div style={{width:1,alignSelf:"stretch",background:T.border}}/>

              <div style={{width:180,display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:`${sigCol}12`,border:`1px solid ${sigCol}30`,borderRadius:6,padding:"8px 12px"}}>
                  <div style={{fontSize:7,color:T.muted,marginBottom:2,letterSpacing:1}}>FACTOR CLAVE</div>
                  <div style={{fontSize:10,color:sigCol,fontWeight:600,lineHeight:1.3}}>{aiResult.key_factor}</div>
                </div>
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:4}}><span style={{color:T.muted,letterSpacing:1}}>TAKE PROFIT</span><span className="mono" style={{color:T.green,fontWeight:700}}>+{fUSD(tpTarget,false)}</span></div>
                  <div style={{height:5,borderRadius:3,background:T.dim,overflow:"hidden"}}><div style={{width:"0%",height:"100%",background:T.green}}/></div>
                </div>
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:4}}><span style={{color:T.muted,letterSpacing:1}}>STOP LOSS</span><span className="mono" style={{color:T.red,fontWeight:700}}>-{fUSD(slTarget,false)}</span></div>
                  <div style={{height:5,borderRadius:3,background:T.dim,overflow:"hidden"}}><div style={{width:"0%",height:"100%",background:T.red}}/></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STRATEGY TIER BANNER — from backtest/walkforward.mjs validation */}
        {SYMBOL_STRATEGY[symbol]&&SYMBOL_STRATEGY[symbol].tier!=="ROBUSTO"&&(()=>{
          const tier=SYMBOL_STRATEGY[symbol].tier;
          const isDisabled=tier==="SIN-EDGE";
          const col=isDisabled?T.red:T.yellow;
          return(
            <div style={{background:`${col}0e`,border:`1px solid ${col}35`,borderRadius:8,padding:"8px 14px",marginBottom:10,
              display:"flex",alignItems:"center",gap:8,fontSize:10,color:col}}>
              <span style={{fontWeight:900}}>{isDisabled?"⛔":"⚠"}</span>
              <span>
                {isDisabled
                  ?`${symbol}: sin ventaja estadística validada (walk-forward 0/4 folds) — auto-trading desactivado. Solo análisis manual.`
                  :`${symbol}: ventaja inconsistente entre folds de validación — auto-trading activo con umbral de confianza elevado (≥${SYMBOL_STRATEGY[symbol].minConf}%).`}
              </span>
            </div>
          );
        })()}

        {/* MARKET CLOSED BANNER — active symbol is forex/commodity and it's the weekend */}
        {(asset.type==="forex"||asset.type==="commodity")&&!forexMarketOpen&&(
          <div style={{background:`${T.orange}0e`,border:`1px solid ${T.orange}35`,borderRadius:8,padding:"8px 14px",marginBottom:10,
            display:"flex",alignItems:"center",gap:8,fontSize:10,color:T.orange}}>
            <span style={{fontWeight:900}}>🔒</span>
            <span>{symbol}: mercado cerrado (fin de semana) — no se abrirán operaciones aquí hasta que reabra el domingo 22:00 UTC. El bot sigue operando cripto normalmente.</span>
          </div>
        )}

        {/* STATS ROW */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:7,marginBottom:10}}>
          {[
            {l:"BALANCE",    v:`$${balance.toFixed(0)}`,  c:T.accent},
            {l:"NO REALIZ",  v:fUSD(unrealized),           c:unrealized>=0?T.green:T.red},
            {l:"P&L ACUM",   v:fUSD(totalProfit),          c:totalProfit>=0?T.green:T.red},
            {l:"CERRADAS",   v:closedCount,                c:T.yellow},
            {l:"WIN RATE",   v:`${winRate}%`,              c:winRate>=50?T.green:T.red},
            {l:"POSICIONES", v:`${symPositions.length}/${MAX_POSITIONS}`, c:T.text},
          ].map(({l,v,c})=>(
            <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"7px 10px",textAlign:"center"}}>
              <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:2}}>{l}</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {/* INDICATORS */}
        <TechnicalPanel symbol={symbol} price={price} rsi={rsi} macd={macd} bb={bb}
          ema9={ema9} ema21={ema21} volTrend={volTrend} trend1h={trend1h} precision={asset.precision}/>

        {/* CHART — Lightweight Charts */}
        <div style={{background:"#04060f",border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span className="live" style={{fontSize:9,color:T.green}}>EN VIVO</span>
              <span style={{fontSize:9,color:T.muted,letterSpacing:2}}>{symbol}</span>
              {/* INTERVAL BUTTONS */}
              <div style={{display:"flex",gap:3}}>
                {["1m","5m","15m","1h","4h"].map(iv=>(
                  <button key={iv} onClick={()=>setChartInterval(iv)}
                    style={{background:chartInterval===iv?`${T.accent}25`:"transparent",
                      border:`1px solid ${chartInterval===iv?T.accent:T.border}`,
                      color:chartInterval===iv?T.accent:T.muted,
                      borderRadius:4,padding:"2px 7px",cursor:"pointer",
                      fontSize:9,fontWeight:chartInterval===iv?700:400}}>
                    {iv.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:10,fontSize:8,alignItems:"center"}}>
              <span style={{color:T.accent}}>── EMA9/21</span>
              <span style={{color:T.orange}}>── EMA200</span>
              <span style={{color:"#00b8e640"}}>··· BB</span>
              <span style={{color:"#00e67670"}}>··· S</span>
              <span style={{color:"#ff174470"}}>··· R</span>
              {symPositions.length>0&&<span style={{color:T.yellow,fontWeight:700,background:`${T.yellow}15`,padding:"1px 7px",borderRadius:3}}>{symPositions.length} pos activa(s)</span>}
              {positions.length>symPositions.length&&<span style={{color:T.orange,fontSize:8,background:`${T.orange}15`,padding:"1px 7px",borderRadius:3}}>{positions.length-symPositions.length} en otros pares</span>}
            </div>
          </div>
          <div style={{height:660}}>
            <LWChart
              candles={candles}
              positions={symPositions}
              trades={trades}
              symbol={symbol}
              precision={asset.precision}
              srLevels={srLevels}
              aiResult={aiResult}
              tfInterval={chartInterval}
            />
          </div>
        </div>

        {/* POSITIONS del símbolo activo */}
        {symPositions.length>0&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:6}}>POSICIONES ABIERTAS — {symbol} — TP +{fUSD(tpTarget,false)} | SL -{fUSD(slTarget,false)}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {symPositions.map(pos=><PosRow key={pos.id} pos={pos} price={price} precision={asset.precision} tpTarget={tpTarget} slTarget={slTarget} onClose={()=>manualClose(pos.id)}/>)}
            </div>
          </div>
        )}

        {/* AUTO STATUS */}
        {autoMode&&(
          <div className="fade-up" style={{background:`${phaseInfo.color}0e`,border:`1px solid ${phaseInfo.color}35`,borderRadius:8,padding:"10px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:phaseInfo.color,letterSpacing:1}}>{phaseInfo.label}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>{phaseInfo.desc}</div>
              </div>
              {nextSec!==null&&autoPhase!=="analyzing"&&(
                <div style={{textAlign:"center"}}>
                  <div className="mono" style={{fontSize:20,fontWeight:700,color:T.muted}}>{nextSec}s</div>
                  <div style={{fontSize:8,color:T.muted}}>próx análisis</div>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:5,marginTop:8}}>
              {Array.from({length:MAX_POSITIONS},(_,i)=>{
                const pos=positions[i];
                const pnl=pos?posPnL(pos,price,pos.allocatedSize||positionSize):null;
                const col=pos?(pnl>=0?T.green:T.red):T.dim;
                return(
                  <div key={i} style={{flex:1,height:28,border:`1px solid ${col}`,borderRadius:5,background:`${col}12`,
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    {pos?(
                      <>
                        <span style={{fontSize:7,color:col}}>{pos.type}</span>
                        <span className="mono" style={{fontSize:8,color:col}}>{fUSD(pnl)}</span>
                      </>
                    ):(
                      <span style={{fontSize:8,color:T.muted}}>#{i+1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PREDICCIÓN A MEDIANO PLAZO ── */}
        {activePrediction&&(()=>{
          const predCol=activePrediction.signal==="BUY"?T.green:T.red;
          const elapsedMin=Math.floor((Date.now()-activePrediction.timestamp)/60000);
          const elapsedStr=elapsedMin<60?`${elapsedMin}m`:`${Math.floor(elapsedMin/60)}h${elapsedMin%60}m`;
          const status=activePrediction.confirmations>=3?"✅ TENDENCIA CONFIRMADA"
            :activePrediction.invalidations>0?"⚠️ BAJO PRESIÓN"
            :"🔄 VALIDANDO...";
          const statusCol=activePrediction.confirmations>=3?T.green:activePrediction.invalidations>0?T.yellow:T.accent;
          const prec3=ASSETS[activePrediction.symbol]?.precision||5;
          const pipSz=prec3<=3?0.01:0.0001;
          const targetPips=activePrediction.targetPrice?Math.abs(activePrediction.targetPrice-activePrediction.entryPrice)/pipSz:0;
          const stopPips=activePrediction.stopPrice?Math.abs(activePrediction.stopPrice-activePrediction.entryPrice)/pipSz:0;
          const rr=stopPips>0?(targetPips/stopPips).toFixed(1):"—";
          const pctMove=activePrediction.entryPrice?((priceRef.current-activePrediction.entryPrice)/activePrediction.entryPrice*100):0;
          const pnlDir=activePrediction.signal==="BUY"?pctMove:-pctMove;
          return(
            <div className="fade-up" style={{background:T.card,border:`2px solid ${predCol}`,borderRadius:10,padding:"14px 16px",marginBottom:10,position:"relative"}}>
              {/* Glow strip */}
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${predCol}00,${predCol},${predCol}00)`,borderRadius:"10px 10px 0 0"}}/>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:3}}>PREDICCIÓN MEDIANO PLAZO · {activePrediction.symbol}</div>
                  <div style={{fontSize:9,color:statusCol,marginTop:2,fontWeight:700}}>{status}</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{fontSize:8,color:T.muted,textAlign:"right"}}>
                    <div>hace {elapsedStr}</div>
                    <div style={{color:pnlDir>=0?T.green:T.red,fontWeight:700}}>{pnlDir>=0?"+":""}{pctMove.toFixed(3)}% desde entrada</div>
                  </div>
                  <button onClick={()=>{setActivePrediction(null);activePredRef.current=null;}}
                    style={{background:"transparent",border:`1px solid ${T.muted}40`,color:T.muted,
                      borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10}}>✕</button>
                </div>
              </div>
              {/* Signal + Confidence */}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <div style={{background:`${predCol}18`,border:`2px solid ${predCol}`,borderRadius:8,
                  padding:"8px 20px",fontSize:28,fontWeight:900,color:predCol,letterSpacing:2}}>
                  {activePrediction.signal==="BUY"?"▲ BUY":"▼ SELL"}
                </div>
                <div>
                  <div className="mono" style={{fontSize:24,fontWeight:700,color:predCol}}>{activePrediction.confidence}%</div>
                  <div style={{fontSize:8,color:T.muted}}>confianza actual</div>
                </div>
                {/* Confirmations dots */}
                <div style={{marginLeft:"auto",textAlign:"right"}}>
                  <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginBottom:4}}>
                    {Array.from({length:Math.min(activePrediction.confirmations,8)}).map((_,i)=>(
                      <div key={i} style={{width:9,height:9,borderRadius:"50%",background:predCol,opacity:1-i*0.08}}/>
                    ))}
                    {Array.from({length:Math.min(activePrediction.invalidations,3)}).map((_,i)=>(
                      <div key={i} style={{width:9,height:9,borderRadius:"50%",background:T.red}}/>
                    ))}
                  </div>
                  <div style={{fontSize:8,color:T.muted}}>
                    <span style={{color:predCol,fontWeight:700}}>{activePrediction.confirmations}✓</span>
                    {activePrediction.invalidations>0&&<span style={{color:T.red,marginLeft:4}}>{activePrediction.invalidations}✗</span>}
                    {activePrediction.holdCount>0&&<span style={{color:T.muted,marginLeft:4}}>{activePrediction.holdCount}⏸</span>}
                  </div>
                </div>
              </div>
              {/* Prices row */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                {[
                  {l:"ENTRADA",v:fP(activePrediction.entryPrice,prec3),c:T.accent,s:"precio al señalizar"},
                  {l:"🎯 OBJETIVO",v:fP(activePrediction.targetPrice,prec3),c:T.green,s:`+${targetPips.toFixed(1)} pips · R:${rr}`},
                  {l:"🛑 STOP",v:fP(activePrediction.stopPrice,prec3),c:T.red,s:`-${stopPips.toFixed(1)} pips`},
                ].map(({l,v,c,s})=>(
                  <div key={l} style={{background:T.dim,borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>{l}</div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                    <div style={{fontSize:7,color:c,marginTop:2,opacity:.8}}>{s}</div>
                  </div>
                ))}
              </div>
              {/* Reasoning */}
              <div style={{background:T.dim,borderRadius:5,padding:"8px 12px",fontSize:10,color:T.text,lineHeight:1.6,borderLeft:`3px solid ${predCol}`}}>
                {activePrediction.reasoning}
              </div>
              {/* Factor clave */}
              <div style={{marginTop:6,fontSize:9,color:T.muted}}>
                Factor clave: <span style={{color:predCol,fontWeight:700}}>{activePrediction.key_factor}</span>
                <span style={{marginLeft:10,color:T.muted}}>· próxima confirmación en {nextAnalysis?`${Math.ceil(nextAnalysis/1000)}s`:"—"}</span>
              </div>
            </div>
          );
        })()}

        {/* CONTROLS */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <button onClick={()=>runAnalysis("Análisis manual")} disabled={analyzing}
            style={{background:analyzing?T.dim:`${T.accent}14`,border:`1px solid ${analyzing?T.border:T.accent}`,
              color:analyzing?T.muted:T.accent,borderRadius:8,padding:"11px 8px",cursor:analyzing?"not-allowed":"pointer",fontSize:12,fontWeight:700}}>
            {analyzing?"⏳ Analizando...":"🔍 Analizar IA"}
          </button>
          <button onClick={()=>setAutoMode(p=>{if(p){setAutoPhase("idle");setNextAnalysis(null);}return!p;})}
            style={{background:autoMode?`${T.green}14`:"transparent",border:`2px solid ${autoMode?T.green:T.border}`,
              color:autoMode?T.green:T.muted,borderRadius:8,padding:"11px 8px",cursor:"pointer",fontSize:12,fontWeight:700}}>
            {autoMode?"🟢 AUTO ON":"⚪ AUTO OFF"}
          </button>
          <button onClick={()=>loadNews(symbol)} disabled={loadingNews}
            style={{background:loadingNews?T.dim:`${T.yellow}10`,border:`1px solid ${loadingNews?T.border:T.yellow}`,
              color:loadingNews?T.muted:T.yellow,borderRadius:8,padding:"11px 8px",cursor:loadingNews?"not-allowed":"pointer",fontSize:12,fontWeight:700}}>
            {loadingNews?"⏳ Cargando...":"📰 Actualizar Noticias"}
          </button>
        </div>

        {/* PROGRAMAR INICIO AUTOMÁTICO */}
        <SchedulePanel scheduledStart={scheduledStart} setScheduledStart={setScheduledStart}
          scheduleInput={scheduleInput} setScheduleInput={setScheduleInput}
          scheduleRemainingMs={scheduleRemainingMs} autoMode={autoMode} addLog={addLog}/>

        {/* GESTIÓN DE CAPITAL — stake y escalado */}
        <CapitalPanel initialCapital={initialCapital} setInitialCapital={setInitialCapital}
          positionSize={positionSize} setPositionSize={setPositionSize}
          stakeAutoScale={stakeAutoScale} setStakeAutoScale={setStakeAutoScale}
          stakeStep={stakeStep} setStakeStep={setStakeStep}
          stakeGrowthTrigger={stakeGrowthTrigger} setStakeGrowthTrigger={setStakeGrowthTrigger}
          minStake={minStake} setMinStake={setMinStake}/>

        {/* SEÑAL DE TRADING — guía para operar manualmente */}
        {aiResult&&(()=>{
          const isBuy=aiResult.signal==="BUY";
          const isSell=aiResult.signal==="SELL";
          const isHold=aiResult.signal==="HOLD";
          const col=isBuy?T.green:isSell?T.red:T.muted;
          const proj=calcProjection(candles,aiResult,srLevels,chartInterval);
          return(
            <div style={{background:T.card,border:`2px solid ${col}60`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:22,fontWeight:900,color:col,letterSpacing:1}}>
                    {isBuy?"▲ COMPRAR":isSell?"▼ VENDER":"◆ ESPERAR"}
                  </span>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>CONFIANZA IA</span>
                    <span className="mono" style={{fontSize:18,fontWeight:700,color:col}}>{aiResult.confidence}%</span>
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                  <span style={{fontSize:9,color:T.muted}}>Par: <b style={{color:T.text}}>{symbol}</b></span>
                  <span style={{fontSize:9,color:T.muted}}>Precio: <b className="mono" style={{color:T.accent}}>{fP(price,asset.precision)}</b></span>
                </div>
              </div>

              {/* Niveles de entrada */}
              {proj&&!isHold&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                  {[
                    {l:"ENTRADA (precio actual)", v:fP(price,asset.precision), c:col},
                    {l:`OBJETIVO ${isBuy?"RESISTENCIA":"SOPORTE"}`, v:fP(proj.targetPrice,asset.precision), c:isBuy?T.green:T.red},
                    {l:"STOP LOSS", v:fP(proj.stopPrice,asset.precision), c:isBuy?T.red:T.green},
                  ].map(({l,v,c})=>(
                    <div key={l} style={{background:T.dim,borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                      <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:4}}>{l}</div>
                      <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Distancias en pips */}
              {proj&&!isHold&&asset?.type==="forex"&&(
                <div style={{display:"flex",gap:12,marginBottom:8,fontSize:9}}>
                  <span style={{color:T.muted}}>Distancia objetivo: <b style={{color:isBuy?T.green:T.red}}>{Math.round(Math.abs(proj.targetPrice-price)/0.0001)} pips</b></span>
                  <span style={{color:T.muted}}>Stop loss: <b style={{color:T.red}}>{Math.round(Math.abs(proj.stopPrice-price)/0.0001)} pips</b></span>
                  <span style={{color:T.muted}}>R/R: <b style={{color:T.yellow}}>{(Math.abs(proj.targetPrice-price)/Math.abs(proj.stopPrice-price)).toFixed(1)}:1</b></span>
                </div>
              )}

              {/* Razonamiento */}
              <div style={{background:T.dim,borderRadius:6,padding:"8px 10px",fontSize:9,color:T.text,lineHeight:1.6}}>
                {aiResult.reasoning}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:8,color:T.muted}}>
                <span>Factor clave: <b style={{color:T.accent}}>{aiResult.key_factor}</b></span>
                <span>Riesgo: <b style={{color:aiResult.risk==="ALTO"?T.red:aiResult.risk==="MEDIO"?T.yellow:T.green}}>{aiResult.risk}</b></span>
                <span>Noticias: <b style={{color:aiResult.news_impact==="BULLISH"?T.green:aiResult.news_impact==="BEARISH"?T.red:T.muted}}>{aiResult.news_impact}</b></span>
              </div>
              {!isHold&&proj&&(
                <div style={{marginTop:6,fontSize:8,color:T.muted,borderTop:`1px solid ${T.border}`,paddingTop:6}}>
                  Proyección dibujada en el gráfico · línea punteada {isBuy?"verde":"roja"} → objetivo · zona sombreada = rango de incertidumbre
                </div>
              )}
            </div>
          );
        })()}

        {/* PATTERNS PANEL */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>PATRONES CHARTISTAS DETECTADOS · {symbol}</span>
            <span style={{fontSize:8,color:T.muted}}>últimas 60 velas</span>
          </div>
          {patterns.length===0?(
            <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>Sin patrones claros detectados en este momento.</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {patterns.map((p,i)=>{
                const col=p.signal==="BULLISH"?T.green:p.signal==="BEARISH"?T.red:T.yellow;
                const typeCol=p.type==="REVERSAL"?T.orange:p.type==="BILATERAL"?T.yellow:T.accent;
                return(
                  <div key={i} style={{background:`${col}0c`,border:`1px solid ${col}35`,borderRadius:7,padding:"8px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
                    <span style={{fontSize:18,color:col,minWidth:24,textAlign:"center",marginTop:2}}>{p.emoji}</span>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <span style={{fontSize:12,fontWeight:700,color:col}}>{p.name}</span>
                        <span style={{fontSize:7,fontWeight:700,color:typeCol,background:`${typeCol}18`,padding:"1px 6px",borderRadius:3,letterSpacing:1}}>{p.type}</span>
                        <span style={{fontSize:7,fontWeight:700,color:col,background:`${col}18`,padding:"1px 6px",borderRadius:3,letterSpacing:1}}>{p.signal}</span>
                        <span style={{fontSize:7,color:T.muted,marginLeft:"auto"}}>{p.conf}% confianza</span>
                      </div>
                      <div style={{fontSize:10,color:T.text,lineHeight:1.5,opacity:.8}}>{p.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        </div>{/* end left column */}

        <div style={{minWidth:0}}>{/* right column: contexto */}

        {/* CORRELATION PANEL — only for forex pairs with correlation data */}
        {asset.type==="forex"&&Object.keys(asset.correlations||{}).length>0&&(()=>{
          const corrEntries=Object.entries(asset.correlations);
          const loaded=corrEntries.filter(([s])=>corrSignals[s]);
          const confirmed=loaded.filter(([s,d])=>corrSignals[s]?.confirms);
          const total=corrEntries.length;
          const confCount=confirmed.length;
          const allConfirm=confCount===total&&total>0;
          const noneConfirm=confCount===0&&loaded.length>0;
          const summaryCol=allConfirm?T.green:noneConfirm?T.red:T.yellow;
          return(
            <div style={{background:T.card,border:`1px solid ${summaryCol}40`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>CONFIRMACIÓN DE CORRELACIÓN · {symbol}</span>
                <span style={{fontSize:9,fontWeight:700,color:summaryCol,
                  background:`${summaryCol}18`,padding:"2px 10px",borderRadius:4}}>
                  {loaded.length===0?"⏳ CARGANDO...":
                   allConfirm?"✓✓ MÁXIMA CONFLUENCIA":
                   noneConfirm?"✗ SIN CONFIRMACIÓN — PRECAUCIÓN":
                   `${confCount}/${total} CONFIRMAN`}
                </span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(total,2)},1fr)`,gap:6}}>
                {corrEntries.map(([sym,direction])=>{
                  const info=corrSignals[sym];
                  const col=info?.color||T.muted;
                  const confirms=info?.confirms;
                  const dirLabel=direction>0?"Corr +":"Corr −";
                  const dirDesc=direction>0?"Se mueve igual":"Se mueve opuesto";
                  return(
                    <div key={sym} onClick={()=>handleSymbolChange(sym)}
                      style={{background:`${col}0a`,border:`1px solid ${col}35`,borderRadius:7,
                        padding:"8px 10px",cursor:"pointer",transition:"all .2s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:10,fontWeight:700,color:T.text}}>{sym}</span>
                        <span style={{fontSize:7,color:direction>0?T.green:T.red,
                          background:`${direction>0?T.green:T.red}18`,
                          padding:"1px 5px",borderRadius:3}}>{dirLabel}</span>
                      </div>
                      {info?(
                        <>
                          <div className="mono" style={{fontSize:12,fontWeight:700,color:col,marginBottom:3}}>
                            {fP(info.price,info.precision||5)}
                          </div>
                          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{fontSize:8,fontWeight:700,color:"#04060f",
                              background:col,borderRadius:3,padding:"1px 5px"}}>{info.signal}</span>
                            <span style={{fontSize:8,color:T.muted}}>RSI {info.rsi}</span>
                            <span style={{fontSize:9,color:confirms?T.green:T.red,marginLeft:"auto",fontWeight:700}}>
                              {confirms?"✓ CONFIRMA":"✗ DIVERGE"}
                            </span>
                          </div>
                          <div style={{fontSize:8,color:T.muted,marginTop:3,opacity:.7}}>{dirDesc}</div>
                          {info.samples<10&&<div style={{fontSize:7,color:T.orange,marginTop:2}}>⏳ acumulando datos ({info.samples}/10)</div>}
                        </>
                      ):(
                        <div style={{fontSize:9,color:T.muted}}>Cargando...</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {loaded.length>0&&(
                <div style={{marginTop:8,padding:"5px 10px",borderRadius:5,
                  background:allConfirm?`${T.green}10`:noneConfirm?`${T.red}10`:`${T.yellow}08`,
                  borderLeft:`3px solid ${summaryCol}`,fontSize:10,color:summaryCol}}>
                  {allConfirm
                    ?"Todos los pares confirman la misma dirección del mercado. Alta probabilidad de movimiento sostenido."
                    :noneConfirm
                    ?"Los pares correlacionados contradicen esta señal. Evitar abrir posición hasta que haya confluencia."
                    :"Confluencia parcial. Señal moderada — opera con tamaño reducido o espera mejor confirmación."}
                </div>
              )}
            </div>
          );
        })()}

        {/* LEARNING STATS PANEL */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showLearning?10:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>APRENDIZAJE AUTOMÁTICO · {learningStats?.total||0} trades guardados</span>
              {learningStats&&<span style={{fontSize:8,fontWeight:700,
                color:learningStats.recentWR>=60?T.green:learningStats.recentWR>=40?T.yellow:T.red,
                background:`${learningStats.recentWR>=60?T.green:learningStats.recentWR>=40?T.yellow:T.red}18`,
                padding:"1px 7px",borderRadius:3}}>WR {learningStats.recentWR}% (últimos 20)</span>}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {learningStats&&<span style={{fontSize:8,color:T.accent}}>conf. sugerida: {learningStats.suggestedConf}%</span>}
              <button onClick={()=>setShowLearning(p=>!p)}
                style={{background:"transparent",border:`1px solid ${T.border}`,color:T.muted,
                  borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:9}}>
                {showLearning?"▲ Ocultar":"▼ Ver stats"}
              </button>
              <button onClick={()=>{if(window.confirm("¿Borrar historial de aprendizaje?"))
                {localStorage.removeItem(LS_TRADES);setLearningStats(null);}}}
                style={{background:"transparent",border:`1px solid ${T.border}`,color:T.muted,
                  borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:9}}>
                🗑
              </button>
            </div>
          </div>
          {showLearning&&learningStats&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {/* Global stats */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                {[
                  {l:"TOTAL TRADES", v:learningStats.total,                              c:T.text},
                  {l:"WIN RATE",     v:`${learningStats.wr}%`,                           c:learningStats.wr>=50?T.green:T.red},
                  {l:"P&L ACUMULADO",v:fUSD(learningStats.totalPnl),                     c:learningStats.totalPnl>=0?T.green:T.red},
                  {l:"BUY WR",       v:`${learningStats.byDir.BUY.t?Math.round(learningStats.byDir.BUY.w/learningStats.byDir.BUY.t*100):0}%`, c:T.green},
                  {l:"SELL WR",      v:`${learningStats.byDir.SELL.t?Math.round(learningStats.byDir.SELL.w/learningStats.byDir.SELL.t*100):0}%`,c:T.red},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:T.dim,borderRadius:5,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>{l}</div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              {/* Pattern performance */}
              {learningStats.byPattern.length>0&&(
                <div>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:5}}>RENDIMIENTO POR PATRÓN</div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    {learningStats.byPattern.slice(0,8).map(p=>(
                      <div key={p.name} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:9,color:T.text,minWidth:160}}>{p.name}</span>
                        <div style={{flex:1,height:6,background:T.dim,borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${p.wr}%`,
                            background:p.wr>=60?T.green:p.wr>=40?T.yellow:T.red,
                            borderRadius:3,transition:"width .4s"}}/>
                        </div>
                        <span className="mono" style={{fontSize:9,color:p.wr>=60?T.green:p.wr>=40?T.yellow:T.red,minWidth:40}}>{p.wr}%</span>
                        <span style={{fontSize:8,color:T.muted}}>{p.t} trades</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {learningStats.total===0&&(
                <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>
                  Sin datos aún. El bot aprenderá automáticamente con cada trade cerrado.
                </div>
              )}
            </div>
          )}
          {!learningStats&&(
            <div style={{fontSize:10,color:T.muted,fontStyle:"italic",marginTop:4}}>
              Sin trades aún. Opera con el bot para comenzar el aprendizaje.
            </div>
          )}
        </div>

        {/* NEWS PANEL */}
        {newsData&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
              <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>NOTICIAS EN VIVO · {symbol}</span>
              <span style={{fontSize:9,fontWeight:700,
                color:newsData.market_bias==="bullish"?T.green:newsData.market_bias==="bearish"?T.red:T.muted,
                background:`${newsData.market_bias==="bullish"?T.green:newsData.market_bias==="bearish"?T.red:T.muted}18`,
                padding:"2px 8px",borderRadius:4}}>
                SESGO {(newsData.market_bias||"neutral").toUpperCase()}
              </span>
            </div>
            <div style={{fontSize:10,color:T.muted,background:T.dim,borderRadius:4,padding:"7px 10px",marginBottom:7,lineHeight:1.5}}>
              {newsData.summary}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {newsData.headlines?.map((h,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"3px 0",borderBottom:`1px solid ${T.border}25`}}>
                  <span style={{fontSize:8,minWidth:36,fontWeight:700,
                    color:h.impact==="ALTO"?T.red:h.impact==="MEDIO"?T.yellow:T.muted}}>{h.impact}</span>
                  <span style={{fontSize:9,color:h.sentiment==="bullish"?T.green:h.sentiment==="bearish"?T.red:T.muted,minWidth:4}}>
                    {h.sentiment==="bullish"?"▲":h.sentiment==="bearish"?"▼":"◆"}
                  </span>
                  <span style={{fontSize:10,color:T.text}}>{h.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LOG */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:5}}>LOG DEL SISTEMA</div>
          <div style={{maxHeight:130,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
            {log.length===0&&<div style={{fontSize:10,color:T.muted}}>Sin actividad. Presiona "Analizar IA" o activa AUTO.</div>}
            {log.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:8,fontSize:9,
                color:l.type==="buy"?T.green:l.type==="sell"?T.red:T.muted}}>
                <span className="mono" style={{color:T.muted,minWidth:60,flexShrink:0}}>{l.time}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>

        {/* TRADE HISTORY */}
        {trades.length>0&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:5}}>HISTORIAL ({trades.length} operaciones)</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {trades.slice(0,10).map((t,i)=>{
                const prec=ASSETS[t.symbol]?.precision||5;
                return(
                  <div key={i} style={{display:"flex",gap:8,fontSize:9,padding:"3px 0",borderBottom:`1px solid ${T.border}25`,alignItems:"center"}}>
                    <span style={{color:t.symbol?T.accent:T.muted,fontSize:8,minWidth:55}}>{t.symbol||symbol}</span>
                    <span style={{color:t.type==="BUY"?T.green:T.red,minWidth:28,fontWeight:700}}>{t.type}</span>
                    <span className="mono" style={{color:T.muted}}>{fP(t.entry,prec)}→{fP(t.exit,prec)}</span>
                    <span style={{fontSize:8,color:t.reason==="TP"?T.green:t.reason==="SL"?T.red:T.muted,
                      background:`${t.reason==="TP"?T.green:t.reason==="SL"?T.red:T.muted}15`,
                      padding:"1px 5px",borderRadius:3}}>{t.reason}</span>
                    <span className="mono" style={{color:t.pnl>=0?T.green:T.red,marginLeft:"auto",fontWeight:700}}>{fUSD(t.pnl)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        </div>{/* end right column */}
        </div>{/* end two-column grid */}

        {/* DISCLAIMER */}
        <div style={{fontSize:8,color:T.muted,textAlign:"center",lineHeight:1.9,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
          ⚠️ SEÑALES EDUCATIVAS — Bot de análisis técnico con IA · Forex en vivo vía Yahoo Finance · Crypto vía Binance · Opera manualmente en tu broker · Las proyecciones son estimaciones, no garantías<br/>
          Las señales son educativas y no garantizan resultados en mercados reales. Opera siempre con responsabilidad.
        </div>

        </>)}{/* end dashboard view */}

      </div>
    </>
  );
}
