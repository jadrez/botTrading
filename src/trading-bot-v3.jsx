import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, LineStyle, CrosshairMode } from "lightweight-charts";
import { T, STYLES } from "./theme.js";
import { SYMBOL_STRATEGY, scaledTpSl } from "./lib/symbolStrategy.js";
import { MAX_POSITIONS, MAX_SIM_POSITIONS, MAX_REAL_POSITIONS, MAX_REAL_POSITIONS_PER_SYMBOL, DEFAULT_STAKE, DEFAULT_MULTIPLIER, ANALYSIS_INTERVAL_MS, TRAIL_BREAKEVEN_AT, TRAIL_GIVEBACK, SIM_CONFIDENCE_DISCOUNT, SIM_CONFIDENCE_FLOOR, CORR_DUP_CONFIDENCE_PENALTY } from "./lib/constants.js";
import Sparkline from "./components/Sparkline.jsx";
import TierBadge from "./components/TierBadge.jsx";
import TechnicalPanel from "./components/TechnicalPanel.jsx";
import CapitalPanel from "./components/CapitalPanel.jsx";
import SchedulePanel from "./components/SchedulePanel.jsx";
import RangeBar from "./components/RangeBar.jsx";
import TierLegend from "./components/TierLegend.jsx";
import SignalDistribution from "./components/SignalDistribution.jsx";
import Sidebar from "./components/Sidebar.jsx";

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
  // ── Commodities. XAU/USD: precio real de Deriv (REST+OTP action:"tick",
  // ver fetchCommodityRate/YAHOO_TO_DERIV_TICK), Yahoo como fallback. XAG/XTI
  // siguen en Yahoo (no se verificó Deriv para esos — fuera de alcance).
  "XAU/USD":  { label:"ORO",       type:"commodity", binance:null, forexFrom:"XAU", forexTo:"USD", precision:2, basePrice:2700,
    yahooTicker:"GC=F", derivTickSymbol:"frxXAUUSD", correlations:{} },
  "XAG/USD":  { label:"PLATA",     type:"commodity", binance:null, forexFrom:"XAG", forexTo:"USD", precision:3, basePrice:32,
    yahooTicker:"SI=F",  correlations:{} },
  "XTI/USD":  { label:"PETRÓLEO",  type:"commodity", binance:null, forexFrom:"XTI", forexTo:"USD", precision:2, basePrice:80,
    yahooTicker:"CL=F",  correlations:{} },
  // ── Sintéticos (Deriv exclusivo — no existen en Yahoo/Binance, el único
  // feed de precio es Deriv mismo vía /api/deriv-order action:"tick"). Punto
  // de partida para Direccional (Rise/Fall) — solo precio/gráfico por ahora,
  // sin backtest ni auto-trading todavía. derivSymbol: "R_75" verificado en
  // vivo contra la API de Deriv.
  "VOL75":    { label:"Volatility 75 Index", type:"synthetic", binance:null, derivSymbol:"R_75", precision:2, basePrice:37700,
    correlations:{} },
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
  // Gold/Silver/Oil are intentionally NOT here — verified live: Deriv's public WS
  // accepts a one-off "frxXAUUSD" ticks_history query fine, but REJECTS it the
  // moment subscribe:1 is added ({"error":{"code":"InvalidSymbol", ...}}) —
  // live subscription for metals just isn't offered on this feed, historical
  // replay is. That error also came back with msg_type:"ticks_history" (the
  // original request's type), not msg_type:"error", so the app's own error
  // handling never saw it and never fell back — silently stuck on the initial
  // genCandles($2700-ish placeholder) price forever, visible to a real user as
  // gold "trading" $1600+ below its real price. All three commodities use the
  // Yahoo Finance path instead (real history + 8s polling), which was already
  // built for exactly this and verified returning the correct live price.
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
// Compact date+time for the Histórico table — trades can span multiple days,
// so a bare time-of-day (the old "FECHA" column) wasn't enough to tell them
// apart. "12/09 14:32" fits the same narrow column width.
const fDateTime = ms => ms
  ? new Date(ms).toLocaleString("es",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})
  : "—";

// Deriv multiplier P&L: stake × multiplier × (Δprice / entry). Doesn't (and
// can't, without knowing it) account for commission — fine for Simulado,
// but for a real position it's an ESTIMATE only, and our own price feed can
// drift enough from Deriv's own to flip the sign on a small position.
function posPnL(pos, price, stake=DEFAULT_STAKE){
  const dir  = pos.type==="BUY" ? 1 : -1;
  const mult = pos.multiplier || DEFAULT_MULTIPLIER;
  return dir * (price - pos.entry) / pos.entry * stake * mult;
}

// For a real (Deriv) position, prefer the profit Deriv itself last reported
// (pos.derivProfit, refreshed every 20s by the portfolio-sync effect) — it's
// authoritative: Deriv's own price, commission already netted in. Verified
// live: our own posPnL() showed some AUD/USD positions positive while
// Deriv's own panel showed every one of them negative (commission alone was
// ~$0.20-0.22 per position, enough to flip a near-zero move). Falls back to
// the local estimate only when there's no synced value yet (brand new
// position, or simulated — which has no Deriv profit at all).
function effectivePnL(pos, price, stake=DEFAULT_STAKE){
  return pos.derivContractId && pos.derivProfit!=null ? pos.derivProfit : posPnL(pos,price,stake);
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

// Once the position's peak profit actually REACHES the validated TP, don't
// hard-cap it there — keep the floor rising instead, so a strong trend can
// close well above the original target instead of every winner capping out
// at the same fixed number. The floor starts exactly at tpTarget (never
// worse than the old fixed-TP close) and then gives back only
// TRAIL_GIVEBACK (40%) of whatever profit comes in beyond that, same
// giveback philosophy as the pre-TP trailing stop above. Below tpTarget,
// behavior is unchanged (trailingStopLevel's breakeven/early-trail logic).
function extendedStopLevel(peakPnl, tpTarget, slTarget){
  if(peakPnl>=tpTarget){
    const extra=peakPnl-tpTarget;
    return tpTarget + extra*(1-TRAIL_GIVEBACK);
  }
  return trailingStopLevel(peakPnl, tpTarget, slTarget);
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
// RSI at EVERY point in the series (not just the latest), aligned index-for-
// index with `closes` — needed to compare RSI's value AT a specific past
// pivot (for divergence detection) instead of only its current reading.
// calcRSI only ever looks at its last `p` closes regardless of array length,
// so this is cheap (O(p) per point) even over a few hundred candles.
function calcRSISeries(closes,p=14){
  return closes.map((_,i)=>i>=p?calcRSI(closes.slice(0,i+1),p):50);
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

  // ── Rechazo en EMA200 (confluencia técnica) — pedido explícitamente para
  // oro/plata/petróleo, que se mueven más lento y dan más tiempo de
  // reacción que forex/cripto. Combina los 3 elementos descritos: 1) el
  // precio toca un nivel estructural institucional (EMA200) 2) el RSI está
  // sobrecomprado/sobrevendido EN ESE MISMO momento 3) la vela de ese toque
  // muestra rechazo (mecha larga, cuerpo chico) — la confirmación de que
  // los vendedores/compradores ya tomaron el control, no una predicción a
  // ciegas. Igual que todo lo demás aquí, queda trackeado por símbolo vía
  // byPattern/getPatternAdjustment, así que con el tiempo se puede ver si
  // también funciona en forex/cripto o es específico de materias primas.
  if(candles.length>=200){
    const closesAll=candles.map(cc=>cc.c);
    const ema200=calcEMA(closesAll,200);
    const rsi=calcRSI(closesAll);
    const touchTol=0.006; // ~0.6% de la EMA200 cuenta como "toque"
    const touchedFromBelow=Math.abs(c.h-ema200)/ema200<touchTol && c.c<ema200;
    const touchedFromAbove=Math.abs(c.l-ema200)/ema200<touchTol && c.c>ema200;
    if(touchedFromBelow && rsi>=70 && upperWick>body*1.3)
      results.push({name:"Rechazo Bajista EMA200", signal:"BEARISH", type:"REVERSAL", conf:78, emoji:"⊥",
        desc:"Precio tocó la EMA200 desde abajo con RSI en sobrecompra (≥70) y mecha de rechazo arriba → confluencia técnica de giro bajista."});
    if(touchedFromAbove && rsi<=30 && lowerWick>body*1.3)
      results.push({name:"Rechazo Alcista EMA200", signal:"BULLISH", type:"REVERSAL", conf:78, emoji:"⊤",
        desc:"Precio tocó la EMA200 desde arriba con RSI en sobreventa (≤30) y mecha de rechazo abajo → confluencia técnica de giro alcista."});
  }

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
// v3: default capital raised $200 -> $10,000 to match the real Deriv demo
// account balance (verified live: $9,999 before, $9,998 after a $1 test
// trade) instead of an arbitrary paper figure. Key bumped so an existing
// balance already drifted from the old $200 baseline resets to the new one.
const LS_BALANCE= "bot_balance_v3";

function saveTradeLearning(trade){
  try{
    const arr=JSON.parse(localStorage.getItem(LS_TRADES)||"[]");
    arr.unshift(trade);
    localStorage.setItem(LS_TRADES, JSON.stringify(arr.slice(0,500)));
  }catch{}
}
function loadTrades(){ try{return JSON.parse(localStorage.getItem(LS_TRADES)||"[]");}catch{return [];} }

/* ─── EXPERIMENTO: pirámide XAU/USD ──────────────────────────────────────
   Pedido explícitamente a partir de un bot observado en vivo operando oro
   en velas de 1 minuto: entra en la dirección de la vela que acaba de
   cerrar (roja→SELL, verde→BUY), apila otra posición en la MISMA dirección
   cada vez que el P&L agregado de la pila sube $EXP_ADD_STEP más, y si el
   agregado cae al piso (-$50 mientras nunca haya estado en positivo) cierra
   TODA la pila y abre una sola posición en la dirección CONTRARIA,
   repitiendo el ciclo. Completamente aislado de Simulado/Crecimiento: su
   propio historial, su propio feed de velas de XAU/USD (independiente del
   símbolo activo en el gráfico principal), nunca toca open_positions/trades
   en la DB ni la cuenta real de Deriv — es solo para observar en Configuración.

   El piso y el apilado quedaron deliberadamente DESACOPLADOS (pedido
   explícito tras la primera versión): apilar sigue siendo por saltos fijos
   de $EXP_ADD_STEP, pero el piso ahora se calcula de forma continua como
   un porcentaje del PICO (máximo histórico) del P&L de la pila, no un
   salto fijo — así reacciona cada tick, no solo cuando se apila. Con
   EXP_RETAIN_PCT=0.8 el piso a un pico de $50 da exactamente $40 (se
   permite ceder 20%), y de ahí en adelante escala en proporción. Como el
   piso nunca baja (solo sube con nuevos picos) y siempre es una fracción
   POSITIVA de un pico ya positivo, una vez que la pila tocó positivo
   cualquier cierre posterior por este piso queda garantizado en positivo
   — "siempre vamos a requerir en cerrar en positivo". */
const EXP_SYMBOL="XAU/USD"; // valor por defecto — ver expSymbol más abajo (editable en vivo, mismo patrón que expAddStep/expFloorStart)
// Símbolos soportados para el Experimento + su ticker de Binance (precio en
// vivo cuando esta pestaña es la dueña del motor) y su símbolo de Deriv
// (REST+OTP, usado por el servidor y por "open"/"close" cuando Operar en
// vivo está activo — ver api/deriv-order.js SYMBOL_MAP). BTC/USD agregado
// explícitamente para poder seguir probando el motor (simulado) mientras
// XAU/USD está cerrado por fin de semana/feriado — cripto opera 24/7.
// lotUnit: cuántas unidades del subyacente hace 1 "lote" estilo MT5/MT4 —
// 100 oz troy para oro (convención estándar), 1 BTC para cripto (ningún
// "oz" aplica ahí). Antes el cálculo de VOLUMEN MT5 (LOTES) usaba SIEMPRE
// el divisor de oro (÷100) aunque el símbolo fuera BTC — reportado en vivo
// ("ayúdame a saber cuáles son los datos de 0.01 que se maneja en
// volumen"), daba un número sin sentido para cripto.
const EXP_SYMBOLS={
  "XAU/USD":{binance:"PAXGUSDT",deriv:"frxXAUUSD",lotUnit:100},
  "BTC/USD":{binance:"BTCUSDT",deriv:"cryBTCUSD",lotUnit:1},
};
// Fuente de precio EN VIVO del motor: PAXG/USDT en Binance (oro tokenizado,
// respaldado 1:1 por una onza de oro físico), NO el GC=F de Yahoo de arriba.
// Verificado en vivo: Yahoo's commodity quote (usado en el resto de la app
// para oro/plata/petróleo) solo se refresca cada ~10-15s en su propio
// backend — pedir el precio más seguido no lo adelanta, es un límite del
// dato en sí. Deriv tampoco sirve: ya se confirmó antes (ver api/deriv-
// order.js / comentarios del efecto de precio) que frxXAUUSD rechaza la
// suscripción en vivo con InvalidSymbol — reintentado en esta sesión desde
// el servidor de producción y desde un navegador real, ambos bloqueados a
// nivel de red antes de llegar a Deriv. Binance SÍ da ticks genuinamente en
// vivo (mismo mecanismo ya comprobado para ETH/BTC/SOL) — PAXG seguía el
// spot del oro con ~98-297 operaciones/minuto al verificarlo. Diferencia
// honesta: PAXG tiene su propia base (~0.5-1% distinto al spot exacto de
// Yahoo en un momento dado) por ser un instrumento tokenizado, no spot
// puro — trade-off aceptado a cambio de movimiento real cada 1-2s en vez
// de cada ~15s.
const EXP_BINANCE="PAXGUSDT";
// EXP_ADD_STEP/EXP_FLOOR_START son los valores por defecto — ambos quedaron
// editables en vivo (ver expAddStep/expFloorStart más abajo) porque son en
// realidad una función del STAKE: PnL($) = %movimiento_precio × stake × 100,
// así que a qué tan rápido se dispara un apilado/volteo en $50 depende
// totalmente de qué tan grande sea el stake (a $1 de stake, $50 requiere un
// 50% de movimiento del oro — nunca pasa; a $500, solo 0.1%). Se dejan
// ambos campos juntos al stake para que esto se pueda afinar en vivo.
const EXP_ADD_STEP=50;    // $ — cada incremento de esto en el P&L de la pila apila otra posición
const EXP_RETAIN_PCT=0.8; // una vez el pico de la pila es positivo, el piso = pico×este % (20% de giveback)
const EXP_FLOOR_START=-50; // $ — piso inicial (antes de haber estado nunca en positivo)
// Desde cuánto pico POSITIVO arranca a proteger el piso — pedido original
// explícito: "el SL... colocarlo lo más rápido posible... así sea de 10 USD
// positivos". Primera versión armaba desde CUALQUIER centavo positivo (muy
// frágil a stake alto, un solo tick podía atravesarlo — ver fix anterior).
// Segunda versión lo gateó a un paso completo de apilado (expAddStep,
// hasta $50) — demasiado conservador: con eso, un pico de +$10/+$15 no
// protegía NADA y la pila podía caer hasta el piso inicial completo
// (ej. -$40) sin que el +$10 nunca se hubiera "guardado". Esta es la
// tercera versión: un umbral FIJO y chico ($10, igual al número del
// pedido original), independiente de qué tan grande sea expAddStep.
const EXP_FLOOR_ARM_AT=10; // $ — pico mínimo antes de que el piso empiece a subir
const EXP_MAX_STACK=10;  // límite de seguridad de posiciones apiladas a la vez
// Piso de "volteo rápido": pedido explícito en vivo — se observó que, tras
// voltear desde una dirección que venía GANANDO fuerte (ej. BUY +$101,
// +$65, +$39...), la nueva dirección (SELL) se quedaba sola perdiendo
// hasta tocar el piso inicial COMPLETO (ej. -$40/-$41.68) antes de volver
// — mucho margen para una dirección que probablemente era un error, justo
// cuando la dirección anterior SÍ estaba funcionando. Se aplica SOLO
// cuando el ciclo que se acaba de cerrar fue ganador (ver flip() abajo) —
// si el volteo rápido también pierde, el SIGUIENTE intento ya no viene de
// un ciclo ganador, así que usa el piso normal completo — evita que esto
// se convierta en un zigzag infinito de pérdidas chicas en mercado picado.
const EXP_QUICK_REVERSAL_FRACTION=0.3; // 30% del piso inicial normal
// "Canario": la ÚLTIMA posición apilada (la más reciente, más cerca del
// precio actual) como alerta temprana de reversión — pedido explícito:
// las posiciones VIEJAS de la pila ya están profundamente en positivo y
// su P&L domina la suma agregada, así que el piso de TODA la pila puede
// tardar en reaccionar cuando la tendencia realmente ya se dio vuelta —
// la posición más nueva es la primera en sentirlo. Es un gatillo
// ADICIONAL al piso agregado, no lo reemplaza — lo que dispare primero.
//
// v2 (en %, no rango fijo): la v1 usaba un rango fijo (+$5 de pico, luego
// -$5) — encontrado en vivo que esto deja un hueco real: un pico de +$30
// que retrocede a +$2 (un 93% de giveback) NUNCA disparaba porque +$2
// sigue siendo positivo, no cruza a -$5. Ahora reusa EXACTAMENTE el mismo
// % de retención que ya protege la pila entera (EXP_RETAIN_PCT): una vez
// el pico propio de la última posición llega a EXP_CANARY_PEAK, su propio
// piso pasa a ser pico×EXP_RETAIN_PCT — a pico=$30 dispara si cae a $24;
// a pico=$6 dispara si cae a $4.80 (equivalente al -$5 original en picos
// chicos, pero ahora también atrapa el caso de pico grande).
//
// Solo vigila a partir de EXP_CANARY_MIN_STACK posiciones abiertas — con
// 1-2 posiciones el canario y el piso de la pila casi se superponen (la
// "última" ES casi toda la pila), así que no aporta nada ahí; se vuelve
// útil justo cuando ya hay varias posiciones viejas que podrían estar
// escondiendo una reversión reciente detrás de su propio P&L grande.
const EXP_CANARY_PEAK=5, EXP_CANARY_MIN_STACK=3;
// Cobertura ("hedge"): pedido explícito tras confirmar que SÍ se quiere
// cobertura real (dos direcciones abiertas a la vez, no solo voltear más
// temprano) — si la pila principal NUNCA estuvo en positivo y su pérdida
// agregada llega al 50% de expFloorStart (ej. floorStart=-10 → dispara en
// -5), abre UNA sola posición en la dirección CONTRARIA, mismo stake,
// completamente aparte de la pila principal (que sigue con su piso/
// apilado normal, sin tocarla). Solo una cobertura por ciclo — no se
// apila ni se vuelve a abrir otra mientras ya exista una. Se cierra
// junto con la pila principal cuando esta por fin resuelve (toca su piso
// y voltea) — no tiene piso/objetivo propio, por simplicidad (ver
// discusión: la alternativa de un piso independiente para la cobertura
// casi duplica la complejidad de todo el motor).
const EXP_HEDGE_TRIGGER_PCT=0.5; // 50% de expFloorStart
// SL propio de la cobertura: se cierra SOLA si su pérdida llega al mismo
// piso inicial de la pila (expFloorStart) — antes nada la detenía si la
// pila principal se recuperaba a positivo (la cobertura, al ir en la
// dirección contraria, queda entonces del lado perdedor) y tardaba en
// tocar SU propio piso para voltear.
const EXP_HEDGE_STOP_PCT=1;
const LS_EXP_ENABLED="bot_exp_enabled_v1", LS_EXP_STAKE="bot_exp_stake_v1", LS_EXP_TRADES="bot_exp_trades_v1";
const LS_EXP_ADDSTEP="bot_exp_addstep_v1", LS_EXP_FLOORSTART="bot_exp_floorstart_v1";
const LS_EXP_MAXSTACK="bot_exp_maxstack_v1";
const LS_EXP_SYMBOL="bot_exp_symbol_v1";
// La pila/dirección/piso EN VIVO también se persisten (no solo el
// historial cerrado) — verificado en vivo: sin esto, recargar la página
// (o cualquier remount) perdía la pila activa de golpe, el panel volvía a
// mostrar "0/10 · dirección —" como si nunca hubiera abierto nada, aunque
// el historial sí seguía mostrando el trade anterior — el experimento no
// estaba "esperando" nada raro, simplemente había perdido la memoria de
// que tenía una pila abierta.
const LS_EXP_LIVE="bot_exp_live_v1";
function loadExpTrades(){ try{return JSON.parse(localStorage.getItem(LS_EXP_TRADES)||"[]");}catch{return [];} }
function saveExpTrades(arr){ try{localStorage.setItem(LS_EXP_TRADES, JSON.stringify(arr.slice(0,200)));}catch{} }

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
  // Graduated around 50% (a real coin flip — not 35/65) instead of a flat
  // dead zone. Found live: "Double Top"/"Double Bottom" fire on ~85% of all
  // trades (680/634 of 792 — the pivot-tolerance that detects them is far
  // too loose, see detectPatterns) sitting at 45-46% WR, which the old
  // 35-65% dead zone scored as a neutral +0 despite real evidence they add
  // no edge — by sheer volume those two patterns alone were -$672 of
  // accumulated pnl.
  // v2: steepened 0.5→1.5. Two more weeks of live data under the v1 slope
  // showed it wasn't enough — Double Top/Bottom sat at 47-49% WR (n=175/171,
  // a huge sample, clearly not noise) and the OLD slope rounded their
  // penalty to -1 or literally -0 (JS: Math.round(-0.5)===-0, and
  // -0===0 is true, so the "if(delta===0)" guard below silently treated a
  // real, measured -$173 combined drag as "no signal at all"). At 1.5,
  // those same win rates now pull a real, felt penalty instead of rounding
  // away. Same ±10/+6 caps as before.
  const delta=Math.max(-10,Math.min(6,Math.round((avgWr-50)*1.5)));
  if(delta===0) return {delta:0, note:null};
  return {delta, note:`patrón histórico ${delta>0?"fuerte":"débil"} (${Math.round(avgWr)}% WR)`};
}

// ── Hour-of-day feedback: found live (Simulado, 1010 trades) that 13h-21h
// UTC — the London/NY liquidity overlap, the session every "more volume =
// better signals" assumption would favor — is consistently the WORST
// stretch of the day: hour 17h UTC alone is -$101.43, the single worst
// hour, while quiet hours like 0h UTC run +$22.62 at 63% WR. Likely more
// false breakouts during the volatility spike than genuine trend starts.
// Same graduated-around-50% shape as getPatternAdjustment, gated on a
// decent per-hour sample so a quiet hour's tiny n can't swing it.
function getHourAdjustment(openTimeMs, byHourStats){
  if(openTimeMs==null || !byHourStats?.length) return {delta:0, note:null};
  const hour=new Date(openTimeMs).getUTCHours();
  const stat=byHourStats.find(h=>h.hour===hour);
  if(!stat || stat.t<10) return {delta:0, note:null};
  const delta=Math.max(-10,Math.min(6,Math.round((stat.wr-50)*1.5)));
  if(delta===0) return {delta:0, note:null};
  return {delta, note:`hora histórica ${delta>0?"fuerte":"débil"} (${stat.wr}% WR · ${hour}h UTC)`};
}

// Real money only: block opening a real position that's actually the SAME
// underlying bet as one already open, dressed up as a "different" symbol.
// EUR/USD and USD/CHF are correlated at -1 (move opposite) — a BUY EUR/USD
// plus a BUY USD/CHF aren't diversification, they're both "USD weakens"
// twice over. Returns the symbol it would duplicate, or null if the new
// position adds independent exposure. ASSETS[x].correlations isn't always
// defined symmetrically, so check both directions.
function findCorrelatedRealDuplicate(sym, type, openRealPositions){
  for(const openPos of openRealPositions){
    if(openPos.symbol===sym) continue; // same symbol — MAX_POSITIONS already caps this
    const corrDir=ASSETS[sym]?.correlations?.[openPos.symbol] ?? ASSETS[openPos.symbol]?.correlations?.[sym];
    if(!corrDir) continue; // no known correlation between these two
    const alignedType=corrDir>0?openPos.type:(openPos.type==="BUY"?"SELL":"BUY");
    if(type===alignedType) return openPos.symbol;
  }
  return null;
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
      tp:pos.tp, sl:pos.sl, derivContractId:pos.derivContractId, commission:pos.commission,
      openedBy:pos.openedBy||"BOT",
      source:pos.source||(pos.correlatedWith?"CORRELATED":"MAIN"), correlatedWith:pos.correlatedWith,
    }),
  }).catch(()=>{});
}
function deletePositionOpen(clientId){
  fetch(`/api/positions?clientId=${encodeURIComponent(clientId)}`,{method:"DELETE"}).catch(()=>{});
}
function saveBalance(b){ try{localStorage.setItem(LS_BALANCE,String(b));}catch{} }
// Default matches bot_initial_capital_v2 (real starting capital) so the
// stake ladder's % growth is measured against the capital you actually
// said you're starting with.
function loadBalance(){
  try{
    const v=localStorage.getItem(LS_BALANCE);
    if(v) return parseFloat(v);
    return parseFloat(localStorage.getItem("bot_initial_capital_v2")||"10000");
  }catch{return 10000;}
}

function calcLearningStats(trades){
  if(!trades.length) return null;
  const byPattern={}, byDir={BUY:{w:0,t:0},SELL:{w:0,t:0}}, byHour={};
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
    // Hour-of-day stats (UTC) — feeds getHourAdjustment
    if(t.openTime){
      const h=new Date(t.openTime).getUTCHours();
      if(!byHour[h])byHour[h]={w:0,t:0,pnl:0};
      byHour[h].t++;
      byHour[h].pnl+=t.pnl;
      if(win)byHour[h].w++;
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

  const sortedHour=Object.entries(byHour)
    .map(([h,{w,t,pnl}])=>({hour:parseInt(h,10),wr:t>0?Math.round(w/t*100):0,t,pnl:Math.round(pnl*100)/100}))
    .sort((a,b)=>a.hour-b.hour);

  return{
    total:trades.length,
    wins:trades.filter(t=>t.pnl>0).length,
    wr:Math.round(trades.filter(t=>t.pnl>0).length/trades.length*100),
    recentWR:Math.round(recentWR*100),
    byDir,
    byPattern:sortedPat,
    byHour:sortedHour,
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
  // Double Top/Bottom get their OWN, much tighter tolerance. Found live
  // (1010+ Simulado trades, 2+ weeks after the downstream confidence-penalty
  // fix alone proved insufficient): at 2.5% these two fired on ~85% of all
  // trades (175/171-trade samples) sitting at 47-49% WR — basically every
  // minor wiggle within a quarter-cent of the prior pivot was being called a
  // real double top/bottom. A genuine double top/bottom is two REJECTIONS at
  // essentially the same level, not "close enough" — 0.8% matches that much
  // more honestly and should cut the false-positive volume sharply.
  const tolDouble=0.008; // 0.8% — Double Top/Bottom only

  // ── Double Bottom (BULLISH REVERSAL)
  if(lows.length>=2){
    const [l1,l2]=lows.slice(-2);
    const diff=Math.abs(l1.price-l2.price)/l1.price;
    const gap=l2.idx-l1.idx;
    if(diff<tolDouble && gap>=5 && gap<=45)
      results.push({name:"Double Bottom", signal:"BULLISH", type:"REVERSAL", conf:72, emoji:"W",
        desc:"Dos mínimos similares: el precio rebotó dos veces en soporte → probable subida."});
  }

  // ── Double Top (BEARISH REVERSAL)
  if(highs.length>=2){
    const [h1,h2]=highs.slice(-2);
    const diff=Math.abs(h1.price-h2.price)/h1.price;
    const gap=h2.idx-h1.idx;
    if(diff<tolDouble && gap>=5 && gap<=45)
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

  // ── Divergencia RSI (la señal predictiva por excelencia para anticipar un
  // giro, descrita explícitamente como pedido: el precio hace un extremo más
  // marcado pero el RSI NO lo confirma → el impulso detrás del movimiento se
  // está agotando, antes de que el precio mismo lo muestre). Compara los dos
  // últimos pivotes (ya calculados arriba por findPivots) contra el RSI que
  // tenía el mercado EN ese mismo pivote, no el RSI actual.
  const rsiSeries=calcRSISeries(recent.map(cc=>cc.c));
  if(highs.length>=2){
    const [h1,h2]=highs.slice(-2);
    if(h2.price>h1.price*1.001 && rsiSeries[h2.idx]<rsiSeries[h1.idx]-3 && rsiSeries[h1.idx]>55)
      results.push({name:"Divergencia Bajista RSI", signal:"BEARISH", type:"REVERSAL", conf:74, emoji:"÷",
        desc:"El precio hace un máximo más alto pero el RSI hace un máximo más bajo → el impulso alcista se agota, posible giro bajista."});
  }
  if(lows.length>=2){
    const [l1,l2]=lows.slice(-2);
    if(l2.price<l1.price*0.999 && rsiSeries[l2.idx]>rsiSeries[l1.idx]+3 && rsiSeries[l1.idx]<45)
      results.push({name:"Divergencia Alcista RSI", signal:"BULLISH", type:"REVERSAL", conf:74, emoji:"÷",
        desc:"El precio hace un mínimo más bajo pero el RSI hace un mínimo más alto → la presión vendedora se agota, posible giro alcista."});
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
      layout:{ background:{color:"#FFFFFF"}, textColor:"#8A7F68" },
      grid:{ vertLines:{color:"#EFE8D4"}, horzLines:{color:"#EFE8D4"} },
      rightPriceScale:{ borderColor:"#D8CDB0" },
      handleScroll:true, handleScale:true,
    };

    // ── MAIN chart
    const main=createChart(mainRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#007A8A50",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#007A8A"},
        horzLine:{color:"#007A8A50",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#007A8A"},
      },
      timeScale:{ borderColor:"#D8CDB0", timeVisible:true, secondsVisible:false, fixLeftEdge:true, rightOffset:10, barSpacing:8 },
      rightPriceScale:{ borderColor:"#D8CDB0", minimumWidth:90 },
      watermark:{ visible:true, text:symbol, fontSize:40, color:"rgba(0,122,138,0.05)", horzAlign:"left", vertAlign:"top" },
    });

    const cs=main.addCandlestickSeries({
      upColor:"#00A868", downColor:"#E5233F",
      borderUpColor:"#00875A", borderDownColor:"#D8112F",
      wickUpColor:"#00875Acc", wickDownColor:"#D8112Fcc",
      priceFormat:{ type:"price", precision, minMove:Math.pow(10,-precision) },
    });
    const vs=main.addHistogramSeries({
      priceFormat:{type:"volume"}, priceScaleId:"vol",
    });
    main.priceScale("vol").applyOptions({ scaleMargins:{top:0.82,bottom:0} });

    const e9s=main.addLineSeries({ color:"#007A8A", lineWidth:1.5, title:"EMA9",  priceLineVisible:false, lastValueVisible:true,  crosshairMarkerVisible:false });
    const e21s=main.addLineSeries({ color:"#B98A00", lineWidth:1.5, title:"EMA21", priceLineVisible:false, lastValueVisible:true,  crosshairMarkerVisible:false });
    const e200s=main.addLineSeries({ color:"#C97A00", lineWidth:2, lineStyle:LineStyle.Dashed, title:"EMA200", priceLineVisible:false, lastValueVisible:true, crosshairMarkerVisible:false });
    const bbu=main.addLineSeries({ color:"#007A8A45", lineWidth:1, lineStyle:LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    const bbm=main.addLineSeries({ color:"#8A7F6850", lineWidth:1, lineStyle:LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    const bbl=main.addLineSeries({ color:"#007A8A45", lineWidth:1, lineStyle:LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });

    // Crosshair legend
    main.subscribeCrosshairMove(p=>{
      const d=p?.seriesData?.get(cs);
      if(d) setLegend(d);
    });

    // ── RSI chart
    const rsiChart=createChart(rsiRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#007A8A30",width:1,style:LineStyle.Dashed,labelVisible:false},
        horzLine:{color:"#007A8A30",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#4A2E7A"},
      },
      timeScale:{ visible:false, borderColor:"#D8CDB0" },
      rightPriceScale:{ borderColor:"#D8CDB0", scaleMargins:{top:0.1,bottom:0.1} },
    });
    const rsiS=rsiChart.addLineSeries({ color:"#8B3FE0", lineWidth:1.5, title:"RSI", priceLineVisible:false, lastValueVisible:true });
    rsiS.createPriceLine({ price:70, color:"#D8112F55", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:"OB 70" });
    rsiS.createPriceLine({ price:30, color:"#00875A55", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:"OS 30" });
    rsiS.createPriceLine({ price:50, color:"#8A7F6850", lineWidth:1, lineStyle:LineStyle.Dotted, axisLabelVisible:false });

    // ── MACD chart
    const macdChart=createChart(macdRef.current,{
      ...base,
      crosshair:{ mode:CrosshairMode.Normal,
        vertLine:{color:"#007A8A30",width:1,style:LineStyle.Dashed,labelVisible:false},
        horzLine:{color:"#007A8A30",width:1,style:LineStyle.Dashed,labelBackgroundColor:"#D8CDB0"},
      },
      timeScale:{ borderColor:"#D8CDB0", timeVisible:true, secondsVisible:false },
      rightPriceScale:{ borderColor:"#D8CDB0" },
    });
    const macdFmt={type:"price",precision:5,minMove:0.00001};
    const macdHist=macdChart.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false, title:"Hist", priceFormat:macdFmt });
    const macdLine=macdChart.addLineSeries({ color:"#007A8A", lineWidth:1.5, title:"MACD", priceLineVisible:false, lastValueVisible:true, priceFormat:macdFmt });
    const macdSig =macdChart.addLineSeries({ color:"#C97A00", lineWidth:1.5, title:"Signal", priceLineVisible:false, lastValueVisible:true, priceFormat:macdFmt });
    macdChart.addLineSeries({ color:"#8A7F6830", lineWidth:1, lineStyle:LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false }).setData([]);

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
        vs.update({time:last.time,value:last.v||0,color:last.c>=last.o?"#00875A40":"#D8112F40"});
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
            macdHist.update({time:last.time,value:mhD_last,color:mhD_last>=0?"#00875A80":"#D8112F80"});
          }
        }
      }catch{}
      return;
    }

    // ── Full setData path: initial load, symbol switch, timeframe change ──
    cs.setData(clean.map(c=>({time:c.time,open:c.o,high:c.h,low:c.l,close:c.c})));
    vs.setData(clean.map(c=>({time:c.time,value:c.v||0,color:c.c>=c.o?"#00875A40":"#D8112F40"})));

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
        mhD.push({time:times[i],value:hv,color:hv>=0?"#00875A80":"#D8112F80"});
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
        price:r.price, color:"#D8112F55", lineWidth:1,
        lineStyle:LineStyle.Dotted, axisLabelVisible:false,
        title:`R×${r.touches}`,
      }));
    });
    (srLevels.supports||[]).forEach(s=>{
      srLines.current.push(cs.createPriceLine({
        price:s.price, color:"#00875A55", lineWidth:1,
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
    const col=isBuy?"#00875A":"#D8112F";
    const colFaint=isBuy?"#00875A28":"#D8112F28";

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
        cs.createPriceLine({price:stopPrice,color:isBuy?"#D8112F":"#00875A",lineWidth:1,
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
      const entryCol=isBuy?"#00875A":"#D8112F";
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
        color: isProfit?"#00875A":"#D8112F",
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
      <div style={{position:"absolute",top:8,left:12,zIndex:10,display:"flex",gap:14,fontSize:11,
        fontFamily:"IBM Plex Mono,monospace",pointerEvents:"none",background:"#FFFFFFdd",padding:"4px 10px",borderRadius:4,border:`1px solid ${T.border}`}}>
        <span style={{color:T.muted,fontWeight:700}}>{symbol}</span>
        {legend&&<>
          <span>O <span style={{color:legend.open>=legend.close?"#D8112F":"#00875A"}}>{Number(legend.open).toFixed(precision)}</span></span>
          <span>H <span style={{color:"#00875A"}}>{Number(legend.high).toFixed(precision)}</span></span>
          <span>L <span style={{color:"#D8112F"}}>{Number(legend.low).toFixed(precision)}</span></span>
          <span>C <span style={{color:legend.close>=legend.open?"#00875A":"#D8112F",fontWeight:700}}>{Number(legend.close).toFixed(precision)}</span></span>
        </>}
        <span style={{color:T.accent,marginLeft:8}}>── EMA9</span>
        <span style={{color:T.yellow}}>── EMA21</span>
        <span style={{color:`${T.accent}80`}}>- - BB</span>
      </div>

      {/* Main chart (candles) */}
      <div ref={mainRef} style={{flex:4,minHeight:0}}/>

      {/* RSI label + chart */}
      <div style={{borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",
        gap:10,padding:"3px 10px",background:"#FFFFFF"}}>
        <span style={{fontSize:9,color:"#8B3FE0",letterSpacing:2,fontFamily:"IBM Plex Mono,monospace",fontWeight:700}}>RSI 14</span>
        <span style={{fontSize:9,color:"#D8112F90"}}>─ 70</span>
        <span style={{fontSize:9,color:"#00875A90"}}>─ 30</span>
      </div>
      <div ref={rsiRef} style={{flex:1,minHeight:0}}/>

      {/* MACD label + chart */}
      <div style={{borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",
        gap:10,padding:"3px 10px",background:"#FFFFFF"}}>
        <span style={{fontSize:9,color:T.accent,letterSpacing:2,fontFamily:"IBM Plex Mono,monospace",fontWeight:700}}>MACD</span>
        <span style={{fontSize:9,color:T.orange}}>── Signal</span>
        <span style={{fontSize:9,color:"#00875A90"}}>▌ Hist+</span>
        <span style={{fontSize:9,color:"#D8112F90"}}>▌ Hist-</span>
      </div>
      <div ref={macdRef} style={{flex:1,minHeight:0}}/>
    </div>
  );
}

/* ─── POSITION ROW ───────────────────────────────────────────────────────── */
function PosRow({pos, price, precision, onClose, tpTarget=3, slTarget=2}){
  const ps=pos.allocatedSize||DEFAULT_STAKE;
  const pnl=effectivePnL(pos,price,ps);
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
        {pos.derivContractId&&<span style={{fontSize:7,color:T.accent,background:`${T.accent}18`,padding:"1px 5px",borderRadius:3}}>DERIV #{String(pos.derivContractId)}</span>}
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

// Oro: precio REAL de Deriv (vía el canal autenticado REST+OTP que ya usa el
// Experimento para operar — action:"tick") en vez de Yahoo. Pedido explícito
// tras ver el precio de ORO desfasado ~$10 contra Deriv ($4071 vs $4061) —
// Yahoo simplemente reporta un spot distinto/con más rezago. Yahoo queda
// como fallback si la llamada a Deriv falla.
const YAHOO_TO_DERIV_TICK={"GC=F":"frxXAUUSD"};
async function fetchDerivTick(derivSymbol){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"tick",derivSymbol})});
    if(r.ok){const d=await r.json();if(typeof d.price==="number")return d.price;}
  }catch{}
  return null;
}
// Fetch commodity spot price via serverless proxy (Yahoo Finance GC=F / SI=F / CL=F)
async function fetchCommodityRate(yahooTicker){
  const derivSym=YAHOO_TO_DERIV_TICK[yahooTicker];
  if(derivSym){
    const dp=await fetchDerivTick(derivSym);
    if(dp!=null) return dp;
  }
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

// Every currently open real contract on the connected Deriv account — used
// to sync Deriv's own view of reality into the app (including positions
// opened manually in DTrader that the bot never knew about).
async function getDerivPortfolio(){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"portfolio"})});
    const d=await r.json();
    return r.ok&&d.positions?d.positions:null;
  }catch{return null;}
}

// Final detail for one specific contract — works even after it's sold/closed
// (Deriv keeps exit_spot/sell_price/profit queryable). Used to find out HOW
// a position closed when Deriv closed it (TP/SL/stop-out) or someone closed
// it manually in DTrader, without the bot itself calling closeDerivOrder.
async function getDerivContract(contractId){
  try{
    const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"contract",contractId})});
    const d=await r.json();
    return r.ok&&d.isSold!=null?d:null;
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
    // problem in the GROQ_API_KEY secret (Fly: `fly secrets set`), not a bug
    // in this app. Distinguish it from a generic network error so it's
    // obvious to fix.
    const isAuthError=r.status===401||r.status===403;
    return{signal:"HOLD",confidence:40,
      reasoning:isAuthError
        ?"GROQ_API_KEY inválida o expirada — genera una nueva en console.groq.com y actualízala con `fly secrets set GROQ_API_KEY=...`."
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
// ── Config view presentational helpers — module-level so React keeps the
// same component identity across renders (defining these INSIDE the config
// view's render would remount every <input> on each render, e.g. dropping
// focus after one keystroke while editing the Crecimiento TP/SL fields).
function ConfigToggle({on,onClick}){
  return(
    <button onClick={onClick} style={{width:36,height:20,borderRadius:10,position:"relative",flex:"0 0 36px",
      border:"none",cursor:"pointer",background:on?T.green:T.border}}>
      <span style={{position:"absolute",top:2,width:16,height:16,borderRadius:"50%",background:"#fff",
        left:on?18:2,transition:"left .15s"}}/>
    </button>
  );
}
function ConfigField({label,...props}){
  return(
    <label style={{display:"flex",flexDirection:"column",gap:3,flex:1}}>
      <span style={{fontSize:7,color:T.muted,letterSpacing:1}}>{label}</span>
      <input {...props} style={{background:props.readOnly?T.dim:"#fff",
        border:`1px solid ${props.readOnly?T.border:T.glow}`,borderRadius:5,color:T.text,
        fontSize:11,padding:"7px 9px",fontFamily:"'IBM Plex Mono',monospace",width:"100%",boxSizing:"border-box"}}/>
    </label>
  );
}
function ConfigRow({children}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderTop:`1px solid ${T.border}`}}>{children}</div>
  );
}
function ConfigCard({title,icon,children,style}){
  return(
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:18,...style}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:2,fontWeight:700,marginBottom:10}}>{icon} {title}</div>
      {children}
    </div>
  );
}

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
  // v3: default stake raised from $0.05 to $3 — Deriv's real commission floor
  // ($0.10/trade minimum) was bigger than the whole TP at $0.05 stake, a
  // guaranteed loss on real money (see DEFAULT_STAKE). Key bumped so
  // existing users pick up the new default too.
  const [positionSize,setPositionSize] = useState(()=>parseFloat(localStorage.getItem("bot_stake_v4")||String(DEFAULT_STAKE)));
  // ── Capital ladder: step the stake up (or down) as the account grows
  // (or shrinks) by stakeGrowthTrigger%, so risk stays proportional to
  // capital instead of fixed at whatever you started with. Step default
  // scaled up alongside the $3 base stake (was $0.05, matched the old
  // $0.05 base — kept proportional here, ~10% of the new base per step).
  const [stakeAutoScale,setStakeAutoScale]   = useState(()=>localStorage.getItem("bot_stake_autoscale")!=="false");
  const [stakeStep,setStakeStep]             = useState(()=>parseFloat(localStorage.getItem("bot_stake_step_v2")||"0.3"));
  const [stakeGrowthTrigger,setStakeGrowthTrigger] = useState(()=>parseFloat(localStorage.getItem("bot_stake_trigger")||"0.20"));
  const [minStake,setMinStake]               = useState(()=>parseFloat(localStorage.getItem("bot_stake_min_v3")||String(DEFAULT_STAKE)));
  const [ladderBaseline,setLadderBaseline]   = useState(()=>parseFloat(localStorage.getItem("bot_ladder_baseline_v2")||String(loadBalance())));
  const [initialCapital,setInitialCapital]   = useState(()=>parseFloat(localStorage.getItem("bot_initial_capital_v2")||"10000"));
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
  // Independent from autoMode (Simulado) — previously ONE switch drove both:
  // any signal either went real (if derivEnabled+eligible) or fell back to
  // Simulado, with no way to run one without the other. Requested live after
  // the user found AUTO OFF explained why nothing was opening, then wanted
  // Simulado and Deriv Real controllable separately instead of coupled.
  const [autoRealMode,setAutoRealMode] = useState(()=>localStorage.getItem("bot_auto_real_mode")==="true");
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
  const [activeView,setActiveView]        = useState("home");
  // v3: seeded from SYMBOL_STRATEGY (walk-forward-validated per-symbol TP/SL),
  // scaled to the initial stake/multiplier — see scaledTpSl() for why this
  // scaling matters (raw SYMBOL_STRATEGY values assume $10×100x).
  const initStake=parseFloat(localStorage.getItem("bot_stake_v4")||String(DEFAULT_STAKE));
  const initMult=parseInt(localStorage.getItem("bot_mult")||String(DEFAULT_MULTIPLIER),10);
  const initScaled=scaledTpSl("ETH/USDT",initStake,initMult);
  const initTp=initScaled?.tp||6.00, initSl=initScaled?.sl||3.00;
  const [tpTarget,setTpTarget]            = useState(()=>parseFloat(localStorage.getItem("bot_tp_v3")||String(initTp)));
  const [slTarget,setSlTarget]            = useState(()=>parseFloat(localStorage.getItem("bot_sl_v3")||String(initSl)));
  const tpTargetRef = useRef(parseFloat(localStorage.getItem("bot_tp_v3")||String(initTp)));
  const slTargetRef = useRef(parseFloat(localStorage.getItem("bot_sl_v3")||String(initSl)));
  // Crecimiento (real) TP/SL override — null means "automatic", i.e. keep
  // using scaledTpSl()'s per-symbol walk-forward-validated value (the fix
  // that made Deriv's own limit_order match the app's own number). A
  // non-null value here takes priority for REAL orders only — Simulado
  // never reads this, it always stays on the automatic validated value so
  // the learning data it generates doesn't get muddied by manual tweaks.
  const [realTpOverride,setRealTpOverride] = useState(()=>{
    const v=localStorage.getItem("bot_real_tp_override"); return v?parseFloat(v):null;
  });
  const [realSlOverride,setRealSlOverride] = useState(()=>{
    const v=localStorage.getItem("bot_real_sl_override"); return v?parseFloat(v):null;
  });
  const realTpOverrideRef = useRef(realTpOverride);
  const realSlOverrideRef = useRef(realSlOverride);
  const [derivEnabled,setDerivEnabled]    = useState(()=>localStorage.getItem("derivEnabled")==="true");
  // Deliberately separate from derivEnabled: derivEnabled ARMS/DISARMS real
  // money (it's the trading gate — see runAnalysis/runAutoScan), so it must
  // stay whatever the user last chose even while they browse. Before this,
  // Operaciones Trading reused derivEnabled to decide which table to show,
  // which meant just clicking over to look at the Simulado table silently
  // disarmed Deriv Real (and vice versa) — the likely reason real trading
  // went quiet after a single position. This is purely a view filter.
  const [tradingViewFilter,setTradingViewFilter] = useState(()=>localStorage.getItem("derivEnabled")==="true");
  // Histórico search filters — independent of tradingViewFilter (sim/real
  // toggle stays as its own switch; these narrow further within that set).
  const [histFrom,setHistFrom]       = useState("");
  const [histTo,setHistTo]           = useState("");
  const [histSymbol,setHistSymbol]   = useState("");
  const [histType,setHistType]       = useState("");
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
  // Gestión de riesgo (Configuración) — consecutiveLossLimit replaces the
  // old hardcoded "3" in closePosition's pause logic; dailyMaxLoss +
  // riskStopEnabled are read by the daily-loss-stop effect below (near
  // totalProfit), which force-disables both AUTO switches when crossed.
  const [consecutiveLossLimit,setConsecutiveLossLimit] = useState(()=>parseInt(localStorage.getItem("bot_cons_loss_limit")||"3",10));
  const [dailyMaxLoss,setDailyMaxLoss] = useState(()=>parseFloat(localStorage.getItem("bot_daily_max_loss")||"25"));
  const [riskStopEnabled,setRiskStopEnabled] = useState(()=>localStorage.getItem("bot_risk_stop_enabled")!=="false");
  const consecutiveLossLimitRef = useRef(consecutiveLossLimit);
  const riskStoppedTodayRef = useRef(false); // one trip per calendar day, re-armed below
  const ema200Ref      = useRef(0);
  const srRef          = useRef({supports:[],resistances:[],all:[]});

  // ── Experimento: pirámide XAU/USD (ver constantes EXP_* arriba) — 100%
  // aislado de Simulado/Crecimiento, su propio feed/estado/historial.
  const [expEnabled,setExpEnabled]     = useState(()=>localStorage.getItem(LS_EXP_ENABLED)==="1");
  const [expStake,setExpStake]         = useState(()=>parseFloat(localStorage.getItem(LS_EXP_STAKE)||"1"));
  // Editables en vivo junto al stake — ver nota en la constante EXP_ADD_STEP
  // arriba sobre por qué estos dos dependen directamente del stake elegido.
  const [expAddStep,setExpAddStep]     = useState(()=>parseFloat(localStorage.getItem(LS_EXP_ADDSTEP)||String(EXP_ADD_STEP)));
  const [expFloorStart,setExpFloorStart] = useState(()=>parseFloat(localStorage.getItem(LS_EXP_FLOORSTART)||String(EXP_FLOOR_START)));
  // Editable por separado — pedido explícito tras ver la pila llena (10/10,
  // $1M de notional) toda al mismo precio: mientras más posiciones apiladas,
  // más grande el salto en dólares por cada % de movimiento, y el piso se
  // revisa cada 1s (no es una orden de stop real) — un salto violento en un
  // solo segundo puede saltárselo. Bajar este número reduce esa concentración.
  const [expMaxStack,setExpMaxStack]   = useState(()=>parseInt(localStorage.getItem(LS_EXP_MAXSTACK)||String(EXP_MAX_STACK),10));
  // Texto "en bruto" de estos 4 campos — SEPARADO del número real que usa
  // el motor. Reportado en vivo: no se podía escribir 0.02 porque el
  // onChange de antes hacía parseFloat(e.target.value)||fallback en CADA
  // tecla — borrar el campo da "", parseFloat("")=NaN, NaN||fallback vuelve
  // al número anterior al instante (nunca se podía vaciar para escribir
  // algo nuevo); y escribir el primer "0" daba parseFloat("0")=0, que en
  // JS es falsy, así que 0||fallback TAMBIÉN saltaba al fallback. Con texto
  // separado se puede escribir libremente ("", "0", "0.", "0.02") y el
  // número real solo se confirma/recorta (min/max) al salir del campo.
  const [expStakeText,setExpStakeText]=useState(String(expStake));
  const [expAddStepText,setExpAddStepText]=useState(String(expAddStep));
  const [expFloorStartText,setExpFloorStartText]=useState(String(expFloorStart));
  const [expMaxStackText,setExpMaxStackText]=useState(String(expMaxStack));
  // Presets guardados — pedido explícito: "me gustaría poderla guardar para
  // ir guardando mis configuraciones". Un array de {name,symbol,stake,
  // addStep,floorStart,maxStack} persistido en bot_config (exp_presets),
  // mismo mecanismo que todo lo demás del Experimento — así se ven iguales
  // desde cualquier dispositivo, no solo localStorage de este navegador.
  const [expPresets,setExpPresets]=useState([]);
  const [expPresetNameInput,setExpPresetNameInput]=useState("");
  // expCandles: velas de 1m, SOLO para la lógica del motor (entrada por
  // color de la vela anterior) — nunca se muestran directamente. El gráfico
  // (RSI/MACD/EMA/velas) se quitó de esta página: el Experimento no usa
  // ninguno de esos indicadores para decidir (solo precio puro — color de
  // vela + % de movimiento), así que mostrarlos ahí era puro adorno sin
  // relación real con la lógica. Pedido explícito: se agregará aparte
  // cuando haya una página de gráfico en vivo de Deriv.
  const [expCandles,setExpCandles]         = useState([]);
  const [expPrice,setExpPrice]         = useState(null);
  const [expPositions,setExpPositions] = useState([]);
  const [expDirection,setExpDirection] = useState(null);
  const [expSymbol,setExpSymbol]       = useState(()=>localStorage.getItem(LS_EXP_SYMBOL)||EXP_SYMBOL);
  const expSymbolRef = useRef(expSymbol);
  // Filtro del HISTÓRICO del Experimento — nombres propios (expHist*) para no
  // chocar con el filtro ya existente del histórico del bot principal
  // (hist*, más abajo). Solo UI, nada se persiste (se resetea al recargar),
  // pedido explícito: Fechas, PAR, TIPO, ganancia/pérdida.
  const [expHistFrom,setExpHistFrom]     = useState("");
  const [expHistTo,setExpHistTo]         = useState("");
  const [expHistSymbol,setExpHistSymbol] = useState("TODOS");
  const [expHistType,setExpHistType]     = useState("TODOS");
  const [expHistResult,setExpHistResult] = useState("TODOS");
  const [expHistPage,setExpHistPage]     = useState(1); // paginación del HISTÓRICO — vuelve a 1 cada vez que cambia el filtro
  useEffect(()=>{setExpHistPage(1);},[expHistFrom,expHistTo,expHistSymbol,expHistType,expHistResult]);
  // RENDIMIENTO POR HORA — agregado en el SERVIDOR sobre TODO el histórico
  // (no solo los últimos N que trae expTrades). Reportado en vivo: "las
  // horas se están actualizando pero no me las está guardando... solo me
  // deja ver 2 horas" — con una estrategia de piso chico generando muchos
  // trades por minuto, los últimos ~500 que trae expTrades caben enteros
  // en 1-2 horas, empujando fuera "lo de anoche". Ver GET /api/exp-trades
  // ?agg=hourly en api/exp-trades.js. Se re-pide cada vez que cambia el
  // filtro O cuando expTrades crece (cierra un trade nuevo) — así el
  // mejor/peor horario sigue siendo dinámico, no una foto fija.
  const [expHourlyStats,setExpHourlyStats]=useState(null); // null=cargando, []=sin datos — el efecto que lo carga vive más abajo, DESPUÉS de declarar expTrades (lo usaba en su dependency array antes de que existiera — "Cannot access before initialization", página en blanco)
  const [expHedgePos,setExpHedgePos] = useState(null); // ver EXP_HEDGE_TRIGGER_PCT — null o UNA posición en la dirección contraria
  // Deliberadamente SIN localStorage (a diferencia de los demás exp_*): no
  // queremos que un navegador muestre "en vivo" por una caché vieja antes de
  // confirmar con la DB — arranca siempre en false hasta que llegue la
  // respuesta real del servidor. Solo el motor del SERVIDOR ejecuta órdenes
  // reales (ver claimOrCheckOwnership) — el navegador nunca abre/cierra en
  // Deriv por su cuenta, solo puede prender/apagar el interruptor y pedir
  // cierres manuales.
  const [expDerivLive,setExpDerivLive] = useState(false);
  const expDerivLiveRef = useRef(false);
  const [expTrades,setExpTrades]       = useState(()=>loadExpTrades());
  // RENDIMIENTO POR HORA — agregado en el SERVIDOR sobre TODO el histórico
  // (no solo los últimos N que trae expTrades). Reportado en vivo: "las
  // horas se están actualizando pero no me las está guardando... solo me
  // deja ver 2 horas" — con una estrategia de piso chico generando muchos
  // trades por minuto, los últimos ~500 que trae expTrades caben enteros
  // en 1-2 horas, empujando fuera "lo de anoche". Ver GET /api/exp-trades
  // ?agg=hourly en api/exp-trades.js. Se re-pide cada vez que cambia el
  // filtro O cuando expTrades crece (cierra un trade nuevo) — así el
  // mejor/peor horario sigue siendo dinámico, no una foto fija.
  useEffect(()=>{
    let alive=true;
    const qs=new URLSearchParams({agg:"hourly",tzOffsetMin:String(new Date().getTimezoneOffset())});
    if(expHistSymbol!=="TODOS") qs.set("symbol",expHistSymbol);
    if(expHistFrom) qs.set("from",expHistFrom);
    if(expHistTo) qs.set("to",expHistTo);
    if(expHistType!=="TODOS") qs.set("type",expHistType);
    if(expHistResult!=="TODOS") qs.set("result",expHistResult);
    fetch(`/api/exp-trades?${qs.toString()}`).then(r=>r.ok?r.json():null).then(d=>{
      if(alive&&d?.hours) setExpHourlyStats(d.hours);
    }).catch(()=>{});
    return()=>{alive=false;};
  },[expHistSymbol,expHistFrom,expHistTo,expHistType,expHistResult,expTrades.length]);
  // HISTÓRICO paginado — la PÁGINA exacta se le pide al SERVIDOR (filtrada
  // en SQL), no se recorta de expTrades del lado del cliente. Reportado en
  // vivo: "no sale paginación de nada y llevo más de 2 mil operaciones" —
  // expTrades solo trae 200 filas al montar, y mientras esta pestaña NO es
  // dueña del motor se refresca con apenas 50 (ver claimOrCheckOwnership) —
  // ninguna de las dos ventanas alcanzaba para ver "ayer" entre miles de
  // filas de hoy, así que nunca había más de una página que mostrar.
  const [expHistRows,setExpHistRows]=useState([]);
  const [expHistTotal,setExpHistTotal]=useState(0);
  // Histórico REAL de Deriv (profit_table) — pedido explícito: "¿puedo ver
  // el histórico de Deriv aquí?" para comparar contra nuestro propio
  // registro. A DIFERENCIA de todo lo demás en esta página, esto NO se
  // auto-actualiza con un useEffect/polling — ya pasamos un día entero
  // chocando contra el límite de velocidad de Deriv por llamadas de más;
  // se pide manualmente con el botón "Actualizar". profit_table no trae
  // symbol/type por contrato (ver comentario en api/deriv-order.js) — para
  // verlos habría que consultar "contract" UNA VEZ POR FILA, exactamente
  // el patrón de llamadas que causó el problema de hoy, así que se deja
  // fuera a propósito; compara por precio/hora contra nuestro HISTÓRICO.
  const [expDerivHistory,setExpDerivHistory]=useState(null); // null=nunca cargado
  const [expDerivHistoryLoading,setExpDerivHistoryLoading]=useState(false);
  const loadExpDerivHistory=async()=>{
    setExpDerivHistoryLoading(true);
    try{
      const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"history",limit:30})});
      const d=await r.json();
      if(r.ok&&d.transactions) setExpDerivHistory(d.transactions);
      else setExpDerivHistory({error:d.error||"Error desconocido"});
    }catch(e){ setExpDerivHistory({error:e.message}); }
    setExpDerivHistoryLoading(false);
  };
  useEffect(()=>{
    let alive=true;
    const qs=new URLSearchParams({limit:"50",offset:String((expHistPage-1)*50)});
    if(expHistSymbol!=="TODOS") qs.set("symbol",expHistSymbol);
    if(expHistFrom) qs.set("from",expHistFrom);
    if(expHistTo) qs.set("to",expHistTo);
    if(expHistType!=="TODOS") qs.set("type",expHistType);
    if(expHistResult!=="TODOS") qs.set("result",expHistResult);
    fetch(`/api/exp-trades?${qs.toString()}`).then(r=>r.ok?r.json():null).then(d=>{
      if(!alive||!d) return;
      setExpHistRows(d.trades||[]);
      setExpHistTotal(d.total??0);
    }).catch(()=>{});
    return()=>{alive=false;};
  },[expHistSymbol,expHistFrom,expHistTo,expHistType,expHistResult,expHistPage,expTrades.length]);
  const expEnabledRef    = useRef(expEnabled);
  const expStakeRef      = useRef(expStake);
  const expPriceRef      = useRef(null);
  const expPositionsRef  = useRef([]);
  const expDirectionRef  = useRef(null);
  const expAddStepRef    = useRef(expAddStep);
  const expFloorStartRef = useRef(expFloorStart);
  const expMaxStackRef   = useRef(expMaxStack);
  const expFloorRef      = useRef(expFloorStart); // piso protector actual del agregado de la pila
  const expAddLevelRef   = useRef(0); // último múltiplo de expAddStep ya usado para apilar otra posición
  const expStackPeakRef  = useRef(0); // máximo histórico del P&L agregado de la pila ACTUAL (se resetea en cada entrada/volteo)
  const expLastPosPeakRef= useRef(0); // pico propio de la ÚLTIMA posición apilada (canario de reversión, ver EXP_CANARY_*)
  const expLastAddPriceRef= useRef(null); // precio de entrada de la ÚLTIMA posición apilada (exige movimiento real de precio antes de apilar otra, ver nota en evaluateStack)
  const expHedgePosRef = useRef(null); // ver EXP_HEDGE_TRIGGER_PCT
  // Identidad de esta pestaña/dispositivo + si es la que actualmente "maneja"
  // el motor (ver efecto de abajo) — necesario desde que el estado se
  // sincroniza por DB: si dos pestañas/dispositivos tuvieran el experimento
  // activo a la vez, ambas podrían decidir apilar/voltear para el MISMO
  // cruce de umbral y duplicar operaciones reales (bueno, simuladas, pero
  // igual de confuso). Solo una "es dueña" en un momento dado.
  const expSessionIdRef=useRef(null);
  if(expSessionIdRef.current===null) expSessionIdRef.current=Math.random().toString(36).slice(2)+Date.now().toString(36);
  const expIsOwnerRef=useRef(true);
  // Evita la carrera: si estos 4 efectos escribieran a la DB desde el
  // primer render, un cambio del usuario hecho ANTES de que termine la
  // carga inicial (fetch async abajo) podía llegar a la DB primero, y
  // luego esa misma carga inicial lo pisaba al aplicar el valor viejo que
  // ya estaba guardado — verificado en vivo con dos pestañas: el stake
  // escrito en la primera terminaba revertido a "1" por la propia carga.
  // No se escribe nada a la DB hasta que expSyncedRef sea true.
  const expSyncedRef=useRef(false);
  useEffect(()=>{expEnabledRef.current=expEnabled; try{localStorage.setItem(LS_EXP_ENABLED,expEnabled?"1":"0");}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_enabled",value:expEnabled?"1":"0"})}).catch(()=>{});
  },[expEnabled]);
  useEffect(()=>{expStakeRef.current=expStake; try{localStorage.setItem(LS_EXP_STAKE,String(expStake));}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_stake",value:String(expStake)})}).catch(()=>{});
  },[expStake]);
  useEffect(()=>{expAddStepRef.current=expAddStep; try{localStorage.setItem(LS_EXP_ADDSTEP,String(expAddStep));}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_add_step",value:String(expAddStep)})}).catch(()=>{});
  },[expAddStep]);
  useEffect(()=>{expFloorStartRef.current=expFloorStart; try{localStorage.setItem(LS_EXP_FLOORSTART,String(expFloorStart));}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_floor_start",value:String(expFloorStart)})}).catch(()=>{});
  },[expFloorStart]);
  useEffect(()=>{expMaxStackRef.current=expMaxStack; try{localStorage.setItem(LS_EXP_MAXSTACK,String(expMaxStack));}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_max_stack",value:String(expMaxStack)})}).catch(()=>{});
  },[expMaxStack]);
  useEffect(()=>{expDerivLiveRef.current=expDerivLive;
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_deriv_live",value:expDerivLive?"1":"0"})}).catch(()=>{});
  },[expDerivLive]);
  useEffect(()=>{expSymbolRef.current=expSymbol; try{localStorage.setItem(LS_EXP_SYMBOL,expSymbol);}catch{}
    if(expSyncedRef.current) fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"exp_symbol",value:expSymbol})}).catch(()=>{});
  },[expSymbol]);

  // ── Sincronización inicial desde la DB (una sola vez al montar) — esto es
  // lo que hace que abrir la app desde OTRO navegador/celular muestre la
  // MISMA info en vez de "todo en 0": localStorage es por navegador, esto
  // no. La config/estado-en-vivo gana sobre lo que haya en localStorage de
  // este dispositivo si la DB tiene algo distinto (la DB es la fuente de
  // verdad entre dispositivos); el historial de trades se reemplaza por
  // completo con lo que haya en exp_trades.
  useEffect(()=>{
    (async()=>{
      try{
        const [stateRes,tradesRes]=await Promise.all([
          fetch("/api/exp-state"),
          fetch("/api/exp-trades?limit=200"),
        ]);
        if(stateRes.ok){
          const d=await stateRes.json();
          if(d.exp_enabled!=null) setExpEnabled(d.exp_enabled==="1");
          if(d.exp_stake!=null){ setExpStake(parseFloat(d.exp_stake)); setExpStakeText(d.exp_stake); }
          if(d.exp_add_step!=null){ setExpAddStep(parseFloat(d.exp_add_step)); setExpAddStepText(d.exp_add_step); }
          if(d.exp_floor_start!=null){ setExpFloorStart(parseFloat(d.exp_floor_start)); setExpFloorStartText(d.exp_floor_start); }
          if(d.exp_max_stack!=null){ setExpMaxStack(parseInt(d.exp_max_stack,10)); setExpMaxStackText(d.exp_max_stack); }
          if(d.exp_deriv_live!=null) setExpDerivLive(d.exp_deriv_live==="1");
          // El símbolo restaurado se lee ANTES de aplicar exp_symbol — mismo
          // motivo que el guard del servidor: si hay una posición/cobertura
          // abierta en OTRO símbolo, el de la DB (exp_symbol) se ignora y se
          // usa el de la posición real, para no mezclar precio nuevo contra
          // entrada vieja de otro símbolo (pasó en vivo, ver evaluateStack).
          let liveOpenSymbol=null;
          if(d.exp_live_state){
            try{
              const live=JSON.parse(d.exp_live_state);
              if(live.positions){ expPositionsRef.current=live.positions; setExpPositions(live.positions); }
              if(live.direction!==undefined){ expDirectionRef.current=live.direction; setExpDirection(live.direction); }
              if(live.floor!=null) expFloorRef.current=live.floor;
              if(live.addLevel!=null) expAddLevelRef.current=live.addLevel;
              if(live.peak!=null) expStackPeakRef.current=live.peak;
              expHedgePosRef.current=live.hedge??null; setExpHedgePos(live.hedge??null);
              expLastAddPriceRef.current=live.lastAddPrice??null; expLastPosPeakRef.current=live.lastPosPeak??0;
              liveOpenSymbol=live.positions?.[0]?.symbol || live.hedge?.symbol || null;
            }catch{}
          }
          if(liveOpenSymbol && EXP_SYMBOLS[liveOpenSymbol]) setExpSymbol(liveOpenSymbol);
          else if(d.exp_symbol && EXP_SYMBOLS[d.exp_symbol]) setExpSymbol(d.exp_symbol);
          if(d.exp_presets){ try{ const p=JSON.parse(d.exp_presets); if(Array.isArray(p)) setExpPresets(p); }catch{} }
        }
        if(tradesRes.ok){
          const d=await tradesRes.json();
          if(d.trades) setExpTrades(d.trades);
        }
      }catch{}
      finally{ expSyncedRef.current=true; } // recién desde aquí los 4 efectos de arriba empiezan a escribir a la DB
    })();
  },[]);

  const posRef    = useRef([]);
  const priceRef  = useRef(ASSETS["ETH/USDT"].basePrice);
  const autoRef   = useRef(false);
  const autoRealRef = useRef(false);
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
  const positionSizeRef= useRef(parseFloat(localStorage.getItem("bot_stake_v4")||String(DEFAULT_STAKE)));
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
  useEffect(()=>{autoRealRef.current=autoRealMode;localStorage.setItem("bot_auto_real_mode",String(autoRealMode));},[autoRealMode]);
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
  useEffect(()=>{positionSizeRef.current=positionSize;localStorage.setItem("bot_stake_v4",String(positionSize));},[positionSize]);
  useEffect(()=>{multiplierRef.current=multiplier;localStorage.setItem("bot_mult",String(multiplier));},[multiplier]);
  useEffect(()=>{tpTargetRef.current=tpTarget;localStorage.setItem("bot_tp_v3",String(tpTarget));},[tpTarget]);
  useEffect(()=>{slTargetRef.current=slTarget;localStorage.setItem("bot_sl_v3",String(slTarget));},[slTarget]);
  useEffect(()=>{realTpOverrideRef.current=realTpOverride;
    if(realTpOverride==null) localStorage.removeItem("bot_real_tp_override");
    else localStorage.setItem("bot_real_tp_override",String(realTpOverride));},[realTpOverride]);
  useEffect(()=>{realSlOverrideRef.current=realSlOverride;
    if(realSlOverride==null) localStorage.removeItem("bot_real_sl_override");
    else localStorage.setItem("bot_real_sl_override",String(realSlOverride));},[realSlOverride]);
  useEffect(()=>{consecutiveLossLimitRef.current=consecutiveLossLimit;localStorage.setItem("bot_cons_loss_limit",String(consecutiveLossLimit));},[consecutiveLossLimit]);
  useEffect(()=>{localStorage.setItem("bot_daily_max_loss",String(dailyMaxLoss));},[dailyMaxLoss]);
  useEffect(()=>{localStorage.setItem("bot_risk_stop_enabled",String(riskStopEnabled));},[riskStopEnabled]);
  useEffect(()=>{stakeAutoScaleRef.current=stakeAutoScale;localStorage.setItem("bot_stake_autoscale",String(stakeAutoScale));},[stakeAutoScale]);
  useEffect(()=>{stakeStepRef.current=stakeStep;localStorage.setItem("bot_stake_step_v2",String(stakeStep));},[stakeStep]);
  useEffect(()=>{stakeGrowthTriggerRef.current=stakeGrowthTrigger;localStorage.setItem("bot_stake_trigger",String(stakeGrowthTrigger));},[stakeGrowthTrigger]);
  useEffect(()=>{minStakeRef.current=minStake;localStorage.setItem("bot_stake_min_v3",String(minStake));},[minStake]);
  useEffect(()=>{ladderBaselineRef.current=ladderBaseline;localStorage.setItem("bot_ladder_baseline_v2",String(ladderBaseline));},[ladderBaseline]);
  useEffect(()=>{localStorage.setItem("bot_initial_capital_v2",String(initialCapital));},[initialCapital]);

  // ── Load learning history from Postgres on mount — this is what makes
  // "aprendizaje automático" persist across browsers/devices instead of only
  // this one browser's localStorage. localStorage's calcLearningStats(loadTrades())
  // above is the instant first paint; this replaces it once the shared,
  // durable history loads (falls back silently to the local-only view if the
  // DB is unreachable — see api/trades.js).
  useEffect(()=>{
    fetch("/api/trades?limit=5000")
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

  // ── Pull the latest walk-forward re-validation (backtest/update-strategy.mjs,
  // run periodically via GitHub Actions — see .github/workflows) and overlay
  // it onto SYMBOL_STRATEGY. Mutates the existing object's properties IN PLACE
  // (never replaces the module binding) so every consumer that already holds
  // a reference to it (TierBadge, scaledTpSl, runAutoScan, TierLegend, the
  // strategy banners) picks up fresh tiers/TP/SL without any code changes.
  // If the table is empty or unreachable, the hardcoded fallback values stand.
  useEffect(()=>{
    fetch("/api/symbol-strategy")
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(!d?.strategies?.length) return;
        let updated=0;
        for(const s of d.strategies){
          if(!s.symbol) continue;
          SYMBOL_STRATEGY[s.symbol]=s.tier==="SIN-EDGE"
            ? {tier:"SIN-EDGE", updatedAt:s.updatedAt}
            : {tier:s.tier, tp:s.tp, sl:s.sl, minConf:s.minConf, updatedAt:s.updatedAt};
          updated++;
        }
        if(updated) addLog(`📊 Estrategia por símbolo actualizada desde re-validación automática (${updated} símbolos)`,"info");
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

  // Pérdida máxima diaria — re-checked every time a trade closes (trades
  // changes). Re-arms once today's realized PnL is no longer past the
  // limit, which in practice only happens when the date rolls over since
  // trades only accumulate through the day.
  useEffect(()=>{
    if(!riskStopEnabled) return;
    const todayStr=new Date().toDateString();
    const todayPnl=trades
      .filter(t=>t.closeTime&&new Date(t.closeTime).toDateString()===todayStr)
      .reduce((s,t)=>s+(t.pnl||0),0);
    if(todayPnl<=-dailyMaxLoss){
      if(!riskStoppedTodayRef.current){
        riskStoppedTodayRef.current=true;
        if(autoRef.current||autoRealRef.current){
          setAutoMode(false); setAutoRealMode(false);
          addLog(`🛑 Pérdida máxima diaria alcanzada (${fUSD(todayPnl)} ≤ -${fUSD(dailyMaxLoss,false)}) — AUTO detenido. Reactívalo manualmente en Configuración.`,"sell");
        }
      }
    } else {
      riskStoppedTodayRef.current=false;
    }
  },[trades,riskStopEnabled,dailyMaxLoss,addLog]);

  /* ── Experimento: motor de la pirámide XAU/USD ────────────────────────
     Corre SIEMPRE que expEnabled esté activo, sin importar qué símbolo
     esté el usuario mirando en el gráfico principal — mantiene su propio
     feed de velas de 1m (Yahoo GC=F, el mismo endpoint ya usado para el
     gráfico de oro) y su propio ciclo de apilado/piso/volteo, descrito en
     el comentario de las constantes EXP_* arriba. Nunca llama a Deriv ni
     toca open_positions/trades — todo vive en este efecto + localStorage. */
  useEffect(()=>{
    if(!expEnabled) return;
    let alive=true;

    // Local write en cada llamada (barato); el POST a la DB se throttlea a
    // solo cuando algo REALMENTE cambió (piso se movió o cambió el tamaño
    // de la pila) — evaluateStack llama a esto cada 1s, escribirle a
    // Postgres esa seguido sin necesidad sería ruido puro.
    let lastDbFloor=null, lastDbPosCount=-1, lastDbHedgeOpen=false, lastManualCloseAt=0;
    const persistLive=()=>{
      // lastAddPrice/lastPosPeak van AQUÍ también — no son solo refs internas.
      // Antes NO se persistían: si el dueño del motor cambiaba a mitad de
      // ciclo (pasa seguido, servidor y cliente compiten por el control), el
      // lado nuevo heredaba positions/floor/peak correctos pero lastAddPrice
      // quedaba en null — y el gate de apilado (`lastAddPrice != null && ...`)
      // se queda bloqueado PARA SIEMPRE mientras ese lado sea dueño, aunque
      // el precio siguiera moviéndose a favor. Reportado en vivo: "pasó muy
      // rápido de negativo a positivo y no activó las otras" — la pila se
      // quedó en 3/10 mientras el precio seguía subiendo.
      const snapshot={
        positions:expPositionsRef.current, direction:expDirectionRef.current,
        floor:expFloorRef.current, addLevel:expAddLevelRef.current, peak:expStackPeakRef.current,
        hedge:expHedgePosRef.current, lastAddPrice:expLastAddPriceRef.current, lastPosPeak:expLastPosPeakRef.current,
      };
      try{ localStorage.setItem(LS_EXP_LIVE, JSON.stringify(snapshot)); }catch{}
      // Incluye el estado de la cobertura — sin esto, cerrarla SOLA (nuevo
      // SL propio) sin que floor/cantidad de posiciones cambien a la vez
      // dejaba el POST a la DB sin disparar y la cobertura seguía viéndose
      // "abierta" para cualquier otra pestaña/dispositivo.
      const changed=expFloorRef.current!==lastDbFloor || expPositionsRef.current.length!==lastDbPosCount || !!expHedgePosRef.current!==lastDbHedgeOpen;
      if(changed){
        lastDbFloor=expFloorRef.current; lastDbPosCount=expPositionsRef.current.length; lastDbHedgeOpen=!!expHedgePosRef.current;
        fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({key:"exp_live_state",value:JSON.stringify(snapshot)})}).catch(()=>{});
      }
    };

    // Restaura una pila que ya estaba abierta antes de este mount (p.ej.
    // tras recargar la página) — sin esto se perdía el rastro de la
    // posición/dirección activa y el experimento parecía "congelado"
    // esperando la próxima vela aunque en realidad tenía una pila abierta.
    try{
      const saved=JSON.parse(localStorage.getItem(LS_EXP_LIVE)||"null");
      if(saved?.positions?.length){
        expPositionsRef.current=saved.positions;
        expDirectionRef.current=saved.direction;
        expFloorRef.current=saved.floor??expFloorStartRef.current;
        expAddLevelRef.current=saved.addLevel??0;
        expStackPeakRef.current=saved.peak??0;
        expHedgePosRef.current=saved.hedge??null;
        expLastAddPriceRef.current=saved.lastAddPrice??null;
        expLastPosPeakRef.current=saved.lastPosPeak??0;
        setExpPositions(saved.positions);
        setExpDirection(saved.direction);
        setExpHedgePos(saved.hedge??null);
        addLog(`🧪 Experimento: pila restaurada (${saved.positions.length}/${expMaxStackRef.current} ${saved.direction}, piso ${fUSD(expFloorRef.current)})`,"info");
      }
    }catch{}

    const addExpPos=(type,pattern="VELA ANTERIOR")=>{
      const price=expPriceRef.current;
      if(!price || expPositionsRef.current.length>=expMaxStackRef.current) return;
      // symbol se graba EN LA POSICIÓN al abrir — mismo motivo que en el
      // servidor: si expSymbol llegara a cambiar con esto todavía abierto,
      // el registro y la evaluación pueden saber de verdad en qué símbolo
      // se abrió, en vez de asumir el expSymbol actual (que pudo cambiar).
      const pos={id:Date.now()+Math.random(), type, entry:price, allocatedSize:expStakeRef.current,
        multiplier:DEFAULT_MULTIPLIER, openTime:Date.now(), pattern, symbol:expSymbolRef.current};
      expPositionsRef.current=[...expPositionsRef.current,pos];
      expLastPosPeakRef.current=0; // nueva "última" posición — el canario arranca de cero para ella
      expLastAddPriceRef.current=price; // próxima apilada exige moverse desde ESTE precio, no desde el agregado
      setExpPositions(expPositionsRef.current);
      persistLive();
      addLog(`🧪 Experimento ${type} ${expSymbolRef.current} @ ${fP(price,2)} — pila ${expPositionsRef.current.length}/${expMaxStackRef.current}`,type==="BUY"?"buy":"sell");
    };

    const closeAllExpPos=(exitPrice,reason)=>{
      // objetivo/stop de la pila en el momento EXACTO del cierre — hay que
      // leerlos ANTES de resetStackTracking (que se llama justo después en
      // flip()), si no quedarían en 0/piso-inicial para el histórico.
      const objetivo=expAddLevelRef.current+expAddStepRef.current;
      const stop=expFloorRef.current;
      const closed=expPositionsRef.current.map(pos=>({
        ...pos, symbol:pos.symbol||expSymbolRef.current, exit:exitPrice, pnl:posPnL(pos,exitPrice,pos.allocatedSize),
        reason, objetivo, stop, time:now(), closeTime:Date.now(), tradeTime:Math.floor(Date.now()/1000),
      }));
      expPositionsRef.current=[];
      setExpPositions([]);
      persistLive();
      setExpTrades(prev=>{const next=[...closed,...prev].slice(0,200); saveExpTrades(next); return next;});
      // DB-backed historial (lo que hace que otro navegador/dispositivo vea
      // las mismas operaciones) — una fila por posición cerrada.
      closed.forEach(c=>{
        fetch("/api/exp-trades",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            symbol:c.symbol, type:c.type, entryPrice:c.entry, exitPrice:c.exit, pnl:c.pnl, reason:c.reason,
            pattern:c.pattern, objetivoPila:c.objetivo, stopPila:c.stop, allocatedSize:c.allocatedSize, multiplier:c.multiplier,
            openedAt:c.openTime?new Date(c.openTime).toISOString():undefined,
            closedAt:new Date(c.closeTime).toISOString(),
          })}).catch(()=>{});
      });
      return closed.reduce((s,c)=>s+c.pnl,0);
    };

    const resetStackTracking=()=>{
      expFloorRef.current=expFloorStartRef.current; expAddLevelRef.current=0; expStackPeakRef.current=0;
    };

    // Cierra la cobertura (si existe) junto con la pila principal — ver
    // EXP_HEDGE_TRIGGER_PCT: no tiene piso/objetivo propio, vive y muere
    // con el ciclo de la pila que la disparó.
    const closeHedge=(exitPrice)=>{
      const hedge=expHedgePosRef.current;
      if(!hedge) return 0;
      const pnl=posPnL(hedge,exitPrice,hedge.allocatedSize);
      // La cobertura no tiene objetivo/stop propio (ver nota arriba) — se
      // deja constancia del de LA PILA en ese momento, igual que se hace
      // para cada posición normal al cerrar.
      const objetivo=expAddLevelRef.current+expAddStepRef.current;
      const stop=expFloorRef.current;
      expHedgePosRef.current=null;
      setExpHedgePos(null);
      persistLive();
      const closedAt=Date.now();
      setExpTrades(prev=>{
        const next=[{...hedge,symbol:hedge.symbol||expSymbolRef.current,exit:exitPrice,pnl,reason:"HEDGE",objetivo,stop,time:now(),
          closeTime:closedAt,tradeTime:Math.floor(closedAt/1000)},...prev].slice(0,200);
        saveExpTrades(next); return next;
      });
      fetch("/api/exp-trades",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          symbol:hedge.symbol||expSymbolRef.current, type:hedge.type, entryPrice:hedge.entry, exitPrice, pnl, reason:"HEDGE",
          pattern:"COBERTURA", objetivoPila:objetivo, stopPila:stop, allocatedSize:hedge.allocatedSize, multiplier:hedge.multiplier,
          openedAt:hedge.openTime?new Date(hedge.openTime).toISOString():undefined,
          closedAt:new Date(closedAt).toISOString(),
        })}).catch(()=>{});
      addLog(`🛡️ Experimento: cobertura ${hedge.type} cerrada en ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      return pnl;
    };

    // ── Cierre manual (botón "Cerrar"/"Cerrar todo") — el SERVIDOR ya
    // tenía esto (checkManualCloseRequest en server-exp-engine.mjs), pero
    // el CLIENTE solo ENVIABA la solicitud (requestExpManualClose más
    // abajo en el render) y nunca la procesaba. Mientras el símbolo esté
    // en modo simulado (exp_deriv_live=0) el cliente SÍ puede ser dueño
    // del motor (ver claimOrCheckOwnership) — si lo era en ese momento,
    // el botón no hacía nada porque nadie del lado del cliente la leía.
    // Reportado en vivo: "ese botón debería dejarme cerrar las de
    // experimento pero no hace ninguna acción". A diferencia del
    // servidor no hay contratos reales que cerrar en Deriv desde aquí
    // (el cliente nunca ejecuta en Deriv — ver nota de claimOrCheckOwnership
    // más abajo), así que no hace falta el patrón ok/reintento.
    const manualCloseAll=(exitPrice)=>{
      const hedgePnl=closeHedge(exitPrice);
      const totalPnl=closeAllExpPos(exitPrice,"MANUAL")+hedgePnl;
      resetStackTracking();
      expDirectionRef.current=null; setExpDirection(null);
      addLog(`🖐️ Experimento: cierre manual de toda la pila — cerró en ${fUSD(totalPnl)}`,"info");
    };

    // posId identifica por el `id` local de la posición/cobertura — todas
    // lo tienen, sean simuladas (siempre, del lado cliente) o reales.
    const manualCloseOne=(posId,exitPrice)=>{
      if(expHedgePosRef.current?.id===posId){ closeHedge(exitPrice); return; }
      const pos=expPositionsRef.current.find(p=>p.id===posId);
      if(!pos) return;
      const objetivo=expAddLevelRef.current+expAddStepRef.current, stop=expFloorRef.current;
      const pnl=posPnL(pos,exitPrice,pos.allocatedSize);
      expPositionsRef.current=expPositionsRef.current.filter(p=>p.id!==posId);
      setExpPositions(expPositionsRef.current);
      persistLive();
      const closedAt=Date.now();
      const record={...pos,symbol:pos.symbol||expSymbolRef.current,exit:exitPrice,pnl,reason:"MANUAL",objetivo,stop,
        time:now(),closeTime:closedAt,tradeTime:Math.floor(closedAt/1000)};
      setExpTrades(prev=>{const next=[record,...prev].slice(0,200); saveExpTrades(next); return next;});
      fetch("/api/exp-trades",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          symbol:record.symbol, type:record.type, entryPrice:record.entry, exitPrice, pnl, reason:"MANUAL",
          pattern:record.pattern, objetivoPila:objetivo, stopPila:stop, allocatedSize:record.allocatedSize, multiplier:record.multiplier,
          openedAt:record.openTime?new Date(record.openTime).toISOString():undefined,
          closedAt:new Date(closedAt).toISOString(),
        })}).catch(()=>{});
      addLog(`🖐️ Experimento: cierre manual — pnl ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
    };

    // Igual que el servidor: solo marca la solicitud como "vista" cuando
    // de verdad hay algo que hacer (dueño + precio) — si no, se reintenta
    // sola en el próximo tick apenas este lado sea dueño y tenga precio.
    const checkManualCloseRequest=async()=>{
      if(!expIsOwnerRef.current) return;
      const price=expPriceRef.current;
      if(!price) return;
      try{
        const r=await fetch("/api/exp-state");
        if(!r.ok) return;
        const d=await r.json();
        const req=d.exp_manual_close_request?JSON.parse(d.exp_manual_close_request):null;
        if(!req||!req.requestedAt||req.requestedAt<=lastManualCloseAt) return;
        if(Date.now()-req.requestedAt>30000){ lastManualCloseAt=req.requestedAt; return; } // solicitud vieja, ignorar
        if(req.type==="all") manualCloseAll(price);
        else if(req.type==="one"&&req.posId!=null) manualCloseOne(req.posId,price);
        lastManualCloseAt=req.requestedAt;
      }catch{}
    };

    const flip=(exitPrice)=>{
      // Si hay cobertura abierta y en ESE momento viene ganando, no se
      // cierra — se absorbe como la primera posición de la pila volteada
      // (misma dirección que la cobertura, que es justo la que el precio
      // acaba de demostrar). Antes se cerraban pila Y cobertura juntas y
      // se abría una posición nueva idéntica desde cero: se "reseteaba"
      // una posición que ya iba en positivo justo cuando el precio ya
      // probó ir en esa dirección — pedido explícito: seguir el ciclo
      // desde esa positiva sin cerrarla, y apilar más solo cuando el
      // precio avance el OBJETIVO PILA normal desde aquí.
      const hedge=expHedgePosRef.current;
      const hedgePnlNow=hedge?posPnL(hedge,exitPrice,hedge.allocatedSize):0;
      if(hedge && hedgePnlNow>0){
        const stackPnl=closeAllExpPos(exitPrice,"FLIP");
        const combinedPnl=stackPnl+hedgePnlNow;
        resetStackTracking();
        expHedgePosRef.current=null; setExpHedgePos(null);
        expPositionsRef.current=[hedge]; setExpPositions([hedge]);
        expDirectionRef.current=hedge.type; setExpDirection(hedge.type);
        expLastPosPeakRef.current=0;
        expLastAddPriceRef.current=exitPrice;
        let note=" · cobertura ganadora absorbida como nueva pila (sigue abierta)";
        if(combinedPnl>0){
          expFloorRef.current=expFloorStartRef.current*EXP_QUICK_REVERSAL_FRACTION;
          note+=` · piso ${fUSD(expFloorRef.current)}`;
        }
        persistLive();
        addLog(`🔄 Experimento: pila cerró en ${fUSD(stackPnl)} (cobertura seguía en +${fUSD(hedgePnlNow)}) → continúa como ${hedge.type}${note}`,"info");
        return;
      }

      const hedgePnl=closeHedge(exitPrice);
      const totalPnl=closeAllExpPos(exitPrice,"FLIP")+hedgePnl;
      const opposite=expDirectionRef.current==="BUY"?"SELL":"BUY";
      resetStackTracking();
      let note="";
      if(totalPnl>0){
        // Venimos de un ciclo GANADOR — dale menos margen a esta nueva
        // dirección (piso de volteo rápido): si también resulta un error,
        // volvemos antes en vez de esperar el piso completo otra vez.
        expFloorRef.current=expFloorStartRef.current*EXP_QUICK_REVERSAL_FRACTION;
        note=` · volteo rápido armado (piso ${fUSD(expFloorRef.current)})`;
      }
      addLog(`🔄 Experimento: pila cerró en ${fUSD(totalPnl)} → voltea a ${opposite}${note}`,"info");
      expDirectionRef.current=opposite; setExpDirection(opposite);
      addExpPos(opposite,"VOLTEO");
    };

    const evaluateStack=()=>{
      if(!expIsOwnerRef.current) return; // otra pestaña/dispositivo está manejando el motor ahora
      const price=expPriceRef.current;
      if(!price || !expPositionsRef.current.length) return;
      // Red de seguridad real: pasó en vivo que expSymbol cambió con una
      // posición de OTRO símbolo todavía abierta y esto calculó PnL
      // mezclando el precio nuevo contra una entrada vieja de otro símbolo
      // — números absurdos que dispararon un volteo en bucle. Si algo
      // abierto no coincide con expSymbol, no se evalúa nada hasta
      // resolverlo (el cierre manual sigue funcionando).
      const mismatched=expPositionsRef.current.find(p=>p.symbol && p.symbol!==expSymbolRef.current);
      if(mismatched || (expHedgePosRef.current?.symbol && expHedgePosRef.current.symbol!==expSymbolRef.current)){
        addLog(`⚠️ Experimento: hay posiciones abiertas en otro símbolo distinto a ${expSymbolRef.current} — evaluación detenida hasta resolverlo`,"info");
        return;
      }
      const stackPnl=expPositionsRef.current.reduce((s,p)=>s+posPnL(p,price,p.allocatedSize),0);
      expStackPeakRef.current=Math.max(expStackPeakRef.current,stackPnl);
      // Piso continuo, DESACOPLADO del apilado: mientras el pico de la pila
      // no haya alcanzado EXP_FLOOR_ARM_AT ($10 — el número del pedido
      // original, "así sea de 10 USD positivos"), el piso se queda en
      // expFloorStart. Reportado en vivo: con el gate puesto en expAddStep
      // (hasta $50), un pico de +$10/+$15/+$30 no alcanzaba a proteger NADA
      // y la pila terminaba cerrando en pérdida grande pese a haber tocado
      // positivo — justo lo que "colocar el SL lo más rápido posible" pedía
      // evitar. Con el umbral fijo en $10, un pico de +$10 ya deja el piso
      // en +$8 (80% de retención) — no puede volver a caer tan lejos.
      if(expStackPeakRef.current>=EXP_FLOOR_ARM_AT){
        expFloorRef.current=Math.max(expFloorRef.current, expStackPeakRef.current*EXP_RETAIN_PCT);
      }
      // Cobertura: la pila NUNCA estuvo en positivo (expStackPeakRef sigue
      // en 0 — solo sube con Math.max, así que seguir en 0 prueba que
      // stackPnl jamás cruzó arriba de 0) y la pérdida agregada ya llega al
      // 50% de expFloorStart — abre UNA posición en la dirección contraria,
      // mismo stake, aparte de la pila (que sigue con su piso normal sin
      // tocarla). Solo una vez por ciclo — expHedgePosRef como gate.
      if(!expHedgePosRef.current && expStackPeakRef.current===0 && stackPnl<=expFloorStartRef.current*EXP_HEDGE_TRIGGER_PCT){
        const hedgeType=expDirectionRef.current==="BUY"?"SELL":"BUY";
        const hedge={id:Date.now()+Math.random(), type:hedgeType, entry:price, allocatedSize:expStakeRef.current,
          multiplier:DEFAULT_MULTIPLIER, openTime:Date.now(), pattern:"COBERTURA", symbol:expSymbolRef.current};
        expHedgePosRef.current=hedge;
        setExpHedgePos(hedge);
        persistLive();
        addLog(`🛡️ Experimento: cobertura ${hedgeType} abierta @ ${fP(price,2)} (pila en ${fUSD(stackPnl)})`,hedgeType==="BUY"?"buy":"sell");
      }
      // SL propio de la cobertura — independiente del piso de la pila
      // principal. Sin esto, si la pila principal empieza a recuperarse
      // (vuelve a positivo) la cobertura queda del lado perdedor y nada la
      // detiene hasta que la pila principal voltee por SU cuenta, lo que
      // puede tardar mucho. Se cierra sola en cuanto su propia pérdida
      // llega al mismo piso inicial (expFloorStart) que usa la pila.
      if(expHedgePosRef.current){
        const hedgePnl=posPnL(expHedgePosRef.current,price,expHedgePosRef.current.allocatedSize);
        if(hedgePnl<=expFloorStartRef.current*EXP_HEDGE_STOP_PCT){
          addLog(`🛡️ Experimento: cobertura tocó su propio stop (${fUSD(hedgePnl)}) — se cierra sola`,"info");
          closeHedge(price);
        }
      }
      // Canario: la ÚLTIMA posición apilada se revisa POR SEPARADO de la
      // pila (solo con EXP_CANARY_MIN_STACK+ posiciones abiertas) — si su
      // propio pico llega a EXP_CANARY_PEAK y luego retrocede al mismo %
      // de retención que ya usa el piso agregado, voltea TODA la pila de
      // una vez, sin esperar a que ese piso agregado (más lento porque las
      // posiciones viejas, ya muy en positivo, lo arrastran) reaccione.
      if(expPositionsRef.current.length>=EXP_CANARY_MIN_STACK){
        const lastPos=expPositionsRef.current.at(-1);
        const lastPnl=posPnL(lastPos,price,lastPos.allocatedSize);
        expLastPosPeakRef.current=Math.max(expLastPosPeakRef.current,lastPnl);
        if(expLastPosPeakRef.current>=EXP_CANARY_PEAK){
          const canaryFloor=expLastPosPeakRef.current*EXP_RETAIN_PCT;
          if(lastPnl<=canaryFloor){
            addLog(`🐤 Experimento: canario — última posición tocó +${fUSD(expLastPosPeakRef.current,false)} y cayó a ${fUSD(lastPnl)} (piso propio ${fUSD(canaryFloor)})`,"info");
            flip(price); return;
          }
        }
      }
      // Canario inmediato: el de arriba exige que la última posición
      // PRIMERO haya llegado a +$5 antes de voltear por su retroceso — con
      // piso/paso chicos (pedido explícito de probar ganancias de
      // centavos), la última casi nunca llega a esos +$5 antes de girar,
      // así que esa protección no alcanza a activarse y las posiciones
      // VIEJAS, ya ganando fuerte, esconden la reversión en el agregado
      // durante un rato. Reportado en vivo con datos reales: una pila de 5
      // cerró junta en -$67.63 pese a tener una posición ganadora adentro
      // — "es importante que el último siempre detecte que bajó y cierre
      // todo". Si la ÚLTIMA posición SOLA ya perdió tanto como el piso
      // configurado, voltea ya, sin esperar a que el agregado (con las
      // viejas ganadoras pesando) también lo cruce. No evita la pérdida de
      // un salto de precio que ocurre DENTRO del mismo segundo entre un
      // chequeo y el siguiente (límite real de revisar por sondeo, no de
      // esta regla) — sí reacciona más rápido cuando el giro no es
      // instantáneo.
      // IMPORTANTE: contra expFloorStartRef (PISO INICIAL, fijo), NO contra
      // expFloorRef (que puede haber subido a POSITIVO una vez el pico arma
      // el piso dinámico) — bug encontrado en vivo: con el piso ya en +$51,
      // CUALQUIER posición recién apilada (pnl ~0) habría cumplido "0 <=
      // 51" y volteado TODA la pila ganadora en el siguiente apilado, justo
      // cuando más protección de ganancia hacía falta.
      if(expPositionsRef.current.length>=2){
        const lastPosNow=expPositionsRef.current.at(-1);
        const lastPnlNow=posPnL(lastPosNow,price,lastPosNow.allocatedSize);
        if(lastPnlNow<=expFloorStartRef.current){
          addLog(`🐤 Experimento: canario inmediato — la última posición sola ya perdió ${fUSD(lastPnlNow)} (piso inicial ${fUSD(expFloorStartRef.current)}) — voltea sin esperar al agregado`,"info");
          flip(price); return;
        }
      }
      persistLive(); // guarda el pico/piso actualizado en cada tick, no solo al apilar/cerrar
      if(stackPnl<=expFloorRef.current){ flip(price); return; }
      // Apilar otra posición: exige que el PRECIO se haya movido de verdad
      // desde la entrada de la ÚLTIMA posición apilada — no que la SUMA
      // agregada haya cruzado otro escalón. BUG encontrado en vivo dos
      // veces: la primera versión ("while") apilaba varias de golpe en el
      // MISMO tick; cambiar a "if" (una por tick) ayudó pero no arregló la
      // causa real — con varias posiciones VIEJAS ya ganando fuerte, el
      // AGREGADO sigue creciendo aunque el precio esté quieto (el peso de
      // las viejas solo, sin que la nueva aporte nada), así que seguía
      // apilando varias al MISMO precio en ticks separados. Ahora el
      // umbral se mide en PRECIO desde la última entrada (la misma % que
      // ya se le explica al usuario arriba: expAddStep/(stake×100)), así
      // que apilar de verdad requiere que el precio avance, no que la
      // suma crezca por el peso de las posiciones anteriores.
      const priceStepPct=expAddStepRef.current/(expStakeRef.current*DEFAULT_MULTIPLIER);
      const movedEnough=expLastAddPriceRef.current!=null && (
        expDirectionRef.current==="BUY"
          ? price>=expLastAddPriceRef.current*(1+priceStepPct)
          : price<=expLastAddPriceRef.current*(1-priceStepPct)
      );
      if(movedEnough && expPositionsRef.current.length<expMaxStackRef.current){
        expAddLevelRef.current+=expAddStepRef.current; // solo informativo para la UI (OBJETIVO PILA)
        addExpPos(expDirectionRef.current,"PIRÁMIDE");
      }
    };

    const onCandleClosed=(prevCandle)=>{
      if(!expIsOwnerRef.current) return; // otra pestaña/dispositivo está manejando el motor ahora
      if(expPositionsRef.current.length>0) return; // ya hay una pila activa, se maneja sola
      const dir=prevCandle.c<prevCandle.o?"SELL":prevCandle.c>prevCandle.o?"BUY":null;
      if(!dir) return;
      expDirectionRef.current=dir; setExpDirection(dir);
      resetStackTracking();
      addExpPos(dir,"VELA ANTERIOR");
    };

    // Binance klines → {time(seg), o,h,l,c,v} — mismo shape que usa el resto
    // de la app, solo que la fuente es Binance en vez de Yahoo.
    const fetchBinanceKlines=async(interval,limit)=>{
      const binanceSym=EXP_SYMBOLS[expSymbolRef.current]?.binance||"PAXGUSDT";
      const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`);
      const raw=await r.json();
      if(!Array.isArray(raw)) return null;
      return raw.map(k=>({time:Math.floor(k[0]/1000),o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])}));
    };

    (async()=>{
      try{
        const candles=await fetchBinanceKlines("1m",300);
        if(!alive) return;
        if(candles?.length>5){
          setExpCandles(candles);
          const last=candles.at(-1);
          expPriceRef.current=last.c; setExpPrice(last.c);
        }
      }catch{}
    })();

    // Dueño del motor: solo la pestaña/dispositivo "dueño" llama a
    // addExpPos/flip (evaluateStack/onCandleClosed ya lo chequean arriba) —
    // las demás solo leen y muestran. "Dueño" = guardado en exp_engine_owner
    // con un heartbeat reciente (<15s); si no hay dueño, o el que hay dejó
    // de mandar heartbeat (pestaña cerrada), cualquiera puede reclamarlo.
    // Reclamar en una pestaña NUEVA (activar el toggle ahí) le quita el
    // control a la anterior en el siguiente chequeo de esa — "la última que
    // lo prendió, manda", el modelo mental más simple de explicar.
    const claimOrCheckOwnership=async()=>{
      try{
        const r=await fetch("/api/exp-state");
        if(!r.ok) return;
        const d=await r.json();
        const raw=d.exp_engine_owner||"";
        const [owner,hbStr]=raw.split(":");
        const hbAt=parseInt(hbStr,10)||0;
        const stale=!hbAt||(Date.now()-hbAt)>15000;
        const mine=owner===expSessionIdRef.current;
        // exp_deriv_live FRESCO de la DB en CADA chequeo — antes solo se leía
        // una vez al montar la página (ver el efecto de sincronización
        // inicial). Una pestaña/ventana vieja abierta ANTES de activar "EN
        // VIVO" en otro lado seguía creyendo (para siempre) que el modo
        // simulado seguía activo, reclamaba el motor cuando le tocaba, y
        // abría posiciones SIMULADAS mientras el servidor abría REALES —
        // reportado en vivo: "se están turnando, abre deriv, cierra y
        // después abre simulado con otros parámetros". Actualiza el ref
        // (y el estado visual del interruptor) ANTES de decidir si puede
        // reclamar, así cualquier pestaña obedece el modo real aunque
        // nunca haya tocado el interruptor ella misma.
        const freshDerivLive=d.exp_deriv_live==="1";
        if(freshDerivLive!==expDerivLiveRef.current){ expDerivLiveRef.current=freshDerivLive; setExpDerivLive(freshDerivLive); }
        // En modo "en vivo" (Deriv real) el navegador NUNCA reclama el motor
        // — solo el servidor ejecuta órdenes reales (ver nota junto a
        // expDerivLive arriba). Evita que dos instancias puedan abrir/cerrar
        // la MISMA posición real a la vez, incluso si el servidor tarda en
        // reclamar tras un reinicio — mejor pausar que arriesgar duplicar.
        const canClaim=!expDerivLiveRef.current && (!owner||mine||stale);
        if(canClaim){
          if(!expIsOwnerRef.current && d.exp_live_state){
            // Otra sesión pudo haber mutado positions/floor/peak/hedge mientras
            // nosotros no éramos dueños — si seguimos con lo que teníamos en
            // memoria de ANTES de perder el control, evaluamos contra un
            // estado viejo y la pila puede pasar de largo su piso real.
            // Resincroniza desde la DB antes de volver a evaluar.
            try{
              const live=JSON.parse(d.exp_live_state);
              expPositionsRef.current=live.positions||[]; setExpPositions(live.positions||[]);
              expDirectionRef.current=live.direction??null; setExpDirection(live.direction??null);
              if(live.floor!=null) expFloorRef.current=live.floor;
              if(live.addLevel!=null) expAddLevelRef.current=live.addLevel;
              if(live.peak!=null) expStackPeakRef.current=live.peak;
              expHedgePosRef.current=live.hedge??null; setExpHedgePos(live.hedge??null);
              expLastAddPriceRef.current=live.lastAddPrice??null; expLastPosPeakRef.current=live.lastPosPeak??0;
            }catch{}
          }
          expIsOwnerRef.current=true;
          fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({key:"exp_engine_owner",value:`${expSessionIdRef.current}:${Date.now()}`})}).catch(()=>{});
        } else {
          expIsOwnerRef.current=false;
          // No somos dueños — igual refrescar lo que se muestra con lo que
          // la pestaña dueña ya guardó, para no quedar mostrando datos viejos.
          if(d.exp_live_state){
            try{
              const live=JSON.parse(d.exp_live_state);
              expPositionsRef.current=live.positions||[]; setExpPositions(live.positions||[]);
              expDirectionRef.current=live.direction??null; setExpDirection(live.direction??null);
              if(live.floor!=null) expFloorRef.current=live.floor;
              if(live.addLevel!=null) expAddLevelRef.current=live.addLevel;
              if(live.peak!=null) expStackPeakRef.current=live.peak;
              expHedgePosRef.current=live.hedge??null; setExpHedgePos(live.hedge??null);
              expLastAddPriceRef.current=live.lastAddPrice??null; expLastPosPeakRef.current=live.lastPosPeak??0;
            }catch{}
          }
          // El precio en vivo TAMBIÉN viene del dueño real (Deriv, vía el
          // servidor) en vez de que esta pestaña pida el suyo propio a
          // Binance — si no, "ACTUAL" nunca iba a coincidir con lo que
          // muestra Deriv, aunque se actualizara seguido. Reportado en vivo.
          const dp=parseFloat(d.exp_live_price);
          if(dp&&!isNaN(dp)){ expPriceRef.current=dp; setExpPrice(dp); }
          fetch("/api/exp-trades?limit=50").then(rr=>rr.ok?rr.json():null).then(dd=>{
            if(dd?.trades&&alive) setExpTrades(dd.trades);
          }).catch(()=>{});
        }
      }catch{}
    };
    claimOrCheckOwnership();

    // Guard de reentrancia: setInterval dispara cada 1s SIN esperar a que
    // el callback anterior termine — si la llamada a Binance alguna vez
    // tarda más de 1s (red lenta), dos ticks podían solaparse y evaluar/
    // modificar expPositionsRef.current al mismo tiempo (dos apilados o dos
    // volteos para el mismo cruce de umbral).
    // Auto-recuperable: fetch() no tiene timeout — si esa llamada alguna vez
    // se cuelga de verdad (no solo "lenta", sino que nunca resuelve ni
    // falla), sin esto "ticking" se quedaría en true para siempre y el
    // motor entero se congelaría. Si el tick anterior lleva más de 10s
    // "corriendo" (muy por encima del roundtrip normal), se asume colgado y
    // se deja pasar el siguiente de todas formas.
    let ticking=false, tickStartedAt=0, tickCount=0;
    const iv=setInterval(async()=>{
      const now=Date.now();
      if(!alive) return;
      if(ticking && (now-tickStartedAt)<10000) return;
      ticking=true; tickStartedAt=now;
      try{
      tickCount++;
      // Cada tick (1s), no cada 5: con el chequeo cada 5s, un visor que NO
      // es dueño podía seguir mostrando una posición YA cerrada por el
      // dueño real hasta 5s de más — el precio seguía actualizándose cada
      // 1s sin parar mientras tanto, dando la falsa impresión de que el
      // piso se pasaba de largo. Reportado en vivo ("porque deja llegar a
      // esto -$19 ... es por la tardía de yahoo?" — no era eso, era este
      // desfase de refresco).
      await claimOrCheckOwnership();
      // Si no somos dueños, el precio YA se actualizó arriba (desde
      // exp_live_price, lo que el dueño real está viendo) — no hay nada que
      // decidir (evaluateStack/onCandleClosed chequean isOwner igual, pero
      // ni siquiera vale la pena pedirle su propio precio a Binance: sería
      // otra fuente distinta peleando por mostrarse en "ACTUAL").
      if(!expIsOwnerRef.current){ return; }
      // Precio EN VIVO: Deriv (mismo tick que usa el servidor para decidir),
      // NO Binance — reportado en vivo: "el BITCOIN tiene un valor de 75.596
      // y aquí lo tenemos 75.701", un desfase real entre el spot de Binance
      // y la cotización de Deriv (el venue que de verdad ejecutaría). Unifica
      // la fuente para que el precio mostrado sea siempre el que cuenta.
      const derivSym=EXP_SYMBOLS[expSymbolRef.current]?.deriv;
      const np=derivSym?await fetchDerivTick(derivSym):null;
      if(!np||isNaN(np)||!alive) return;
      expPriceRef.current=np; setExpPrice(np);
      const nowSec=Math.floor(Date.now()/1000);
      setExpCandles(prev=>{
        if(!prev.length) return prev;
        const updated=[...prev];
        const lastIdx=updated.length-1;
        const last={...updated[lastIdx]};
        if(nowSec-last.time>=60){
          updated[lastIdx]=last; // la vela anterior queda fija tal como cerró
          updated.push({time:nowSec,o:np,c:np,h:np,l:np,v:0});
          onCandleClosed(last);
        } else {
          last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
          updated[lastIdx]=last;
        }
        return updated;
      });
      evaluateStack();
      await checkManualCloseRequest();
      }finally{ ticking=false; }
    },1000);

    return()=>{alive=false; clearInterval(iv);};
  },[expEnabled,addLog]);

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

  /* ── Deriv portfolio sync ──────────────────────────────────────────────
     Pulls every currently-open real contract straight from Deriv and merges
     it into `positions`: a contract Deriv reports that we don't already
     track (opened manually in DTrader, or a position the app lost track of
     after a reload) gets ADDED with its real tp/sl/commission. A
     Deriv-tracked position that no longer appears there (closed on Deriv's
     own side — hit its own stop-out, our static TP/SL, or was closed
     manually in DTrader) is RECONCILED: getDerivContract() fetches its
     settled exit_spot/profit (still queryable after being sold — verified
     live) and it's recorded into `trades` exactly like a bot-initiated
     close, instead of silently vanishing with no history row. This is what
     lets the bot's own learning react to everything Deriv actually did, not
     just what the bot itself closed. */
  useEffect(()=>{
    // Deliberately NOT gated on derivEnabled: this is read-only reconciliation
    // (never opens or closes anything itself), so it must keep refreshing
    // pos.derivProfit/derivSpot — which effectivePnL() prefers over our own
    // price feed — for real positions REGARDLESS of whether Deriv Real is
    // currently armed. Verified live: 2 manually-opened AUD/USD positions
    // showed POSITIVE in the app while Deriv reported both negative, because
    // this effect never ran while the arm switch sat on Simulado — viewing
    // accurate real data shouldn't require arming real trading, same
    // reasoning as the tradingViewFilter split earlier.
    const sync=async()=>{
      const derivPositions=await getDerivPortfolio();
      if(!derivPositions) return;
      const derivIds=new Set(derivPositions.map(p=>String(p.contractId)));
      const tracked=posRef.current.filter(p=>p.derivContractId);
      const missing=tracked.filter(p=>!derivIds.has(String(p.derivContractId)));

      // Reconcile every position Deriv no longer reports as open, BEFORE
      // touching state — each needs an async lookup for its real exit detail.
      const reconciled=[];
      for(const pos of missing){
        const detail=await getDerivContract(pos.derivContractId);
        if(!detail){ continue; } // lookup failed — leave it tracked, retry next sync
        if(!detail.isSold){ continue; } // transient gap in the portfolio stream, still actually open
        const pnl=detail.profit??0;
        const posTp=pos.tp??detail.tp, posSl=pos.sl??detail.sl;
        const reason=posTp!=null&&pnl>=posTp*0.95?"TP":posSl!=null&&pnl<=-posSl*0.95?"SL":"MANUAL";
        reconciled.push({pos,detail,pnl,reason});
      }

      if(reconciled.length){
        reconciled.forEach(({pos,detail,pnl,reason})=>{
          deletePositionOpen(pos.id);
          fetch("/api/trades",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              symbol:pos.symbol, type:pos.type, entryPrice:pos.entry, exitPrice:detail.exitSpot??pos.entry,
              pnl, closeReason:reason, derivContractId:pos.derivContractId, commission:pos.commission??detail.commission,
              allocatedSize:pos.allocatedSize, multiplier:pos.multiplier, openedBy:pos.openedBy||"BOT",
              source:pos.source, correlatedWith:pos.correlatedWith,
              openedAt:pos.openTime?new Date(pos.openTime).toISOString():undefined,
              closedAt:detail.closeTime?new Date(detail.closeTime).toISOString():undefined,
            }),
          }).catch(()=>{});
          addLog(`🔴 ${reason} ${pos.type} ${pos.symbol} cerrada en Deriv (fuera del bot) → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
        });
        setTrades(t=>[...reconciled.map(({pos,detail,pnl,reason})=>({
          symbol:pos.symbol, type:pos.type, entry:pos.entry, exit:detail.exitSpot??pos.entry, pnl,
          reason, derivContractId:pos.derivContractId, commission:pos.commission??detail.commission,
          allocatedSize:pos.allocatedSize, multiplier:pos.multiplier, openedBy:pos.openedBy||"BOT",
          source:pos.source, correlatedWith:pos.correlatedWith,
          time:now(), tradeTime:Math.floor(Date.now()/1000),
          openTime:pos.openTime, closeTime:detail.closeTime||Date.now(),
          activePatterns:[],
        })),...t.slice(0,49)]);
      }

      setPositions(prev=>{
        const known=new Set(prev.filter(p=>p.derivContractId).map(p=>String(p.derivContractId)));
        const newOnes=derivPositions.filter(p=>!known.has(String(p.contractId))).map(p=>({
          id:`deriv-${p.contractId}`, symbol:p.symbol, type:p.type, entry:p.entry,
          allocatedSize:p.buyPrice, multiplier:p.multiplier, peakPnl:0,
          tp:p.tp, sl:p.sl, derivContractId:p.contractId, commission:p.commission,
          derivProfit:p.profit, derivSpot:p.currentSpot, openedBy:"MANUAL",
          openTime:p.openTime||Date.now(),
        }));
        newOnes.forEach(p=>savePositionOpen(p,null));
        if(newOnes.length) addLog(`🔴 ${newOnes.length} posición(es) real(es) detectada(s) en Deriv y sincronizada(s) (abiertas fuera del bot o recuperadas)`,"info");
        // Drop exactly the positions just reconciled above (recorded into
        // `trades`); everything else stays — including a derivContractId
        // position missing from Deriv's list whose lookup failed or hadn't
        // settled yet, so a transient gap never silently loses a position.
        const reconciledIds=new Set(reconciled.map(r=>String(r.pos.derivContractId)));
        const stillTracked=prev.filter(p=>!p.derivContractId||!reconciledIds.has(String(p.derivContractId)));
        const refreshed=stillTracked.map(p=>{
          if(!p.derivContractId) return p;
          const match=derivPositions.find(dp=>String(dp.contractId)===String(p.derivContractId));
          if(!match) return p;
          // derivProfit/derivSpot: Deriv's own authoritative live P&L and
          // price for this contract, refreshed every sync — see
          // effectivePnL(), which prefers this over our own price feed's
          // estimate for real positions.
          return{...p, commission:p.commission==null?match.commission:p.commission,
            derivProfit:match.profit, derivSpot:match.currentSpot};
        });
        return[...refreshed,...newOnes];
      });
    };
    sync();
    const iv=setInterval(sync,20000);
    return()=>clearInterval(iv);
  },[addLog]);

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
    let backfilled=false; // guards the one-shot real-candle backfill below
    let derivWs=null;
    let wsAlive=true;

    // verified=false is ONLY for the synthetic placeholder below — it must
    // NOT flip priceVerified/forexLive true, or a real open position on this
    // symbol can get its SL/TP evaluated against the fake price for the one
    // render before real data arrives. Verified live: XAU/USD entry $4382.80
    // closed "SL" at exit $2700.00 (the placeholder basePrice) — the TP/SL
    // watcher's only guard is priceVerified, which this call used to set
    // true unconditionally, real data or not.
    const applyForexCandles=(newCandles,rate,verified=true)=>{
      // Guards against the SAME bug class as the verified=false note below,
      // different trigger: an in-flight fetch for the symbol THIS effect was
      // set up for can still resolve after the user switches symbols —
      // clearInterval(iv) in the cleanup only stops FUTURE ticks, it can't
      // cancel one already past its await. Verified live: a stale oil
      // (XTI/USD, ~$97) price fetch resolved after switching to USD/JPY and
      // got written in as USD/JPY's price (~$155), triggering a phantom SL
      // close at a ~38% "loss" that was really just the wrong symbol's rate.
      if(!wsAlive) return;
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
      if(np&&verified) _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
      setForexLive(verified); setPriceVerified(verified);
    };

    if(cur.type==="crypto"){
      const fetchPrice=async()=>{
        try{
          const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cur.binance}`);
          const d=await r.json();
          const np=parseFloat(d.price);
          if(isNaN(np))return;
          if(!wsAlive)return; // see the same guard/comment in applyForexCandles above
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

    } else if(cur.type==="synthetic"){
      // ── SINTÉTICOS (Volatility Index, etc.) — Deriv-exclusive, no
      // Yahoo/Binance feed exists for these. Same incremental-candle polling
      // shape as the crypto branch above, just sourced from our own
      // /api/deriv-order action:"tick" (which authenticates to Deriv
      // server-side) instead of a public REST endpoint. Groundwork for
      // Direccional only — no AUTO/trading logic reads this yet.
      const fetchPrice=async()=>{
        try{
          const r=await fetch("/api/deriv-order",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"tick",derivSymbol:cur.derivSymbol})});
          if(!r.ok)return;
          const d=await r.json();
          const np=parseFloat(d.price);
          if(isNaN(np))return;
          if(!wsAlive)return;
          priceRef.current=np;
          setPrice(np);
          setPriceVerified(true);
          setCandles(prev=>{
            const updated=[...prev];
            const last={...updated[updated.length-1]};
            const nowSec=Math.floor(Date.now()/1000);
            last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
            const cSecs={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[chartIntervalRef.current]||60;
            if(nowSec-last.time>=cSecs){
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
      applyForexCandles(genCandles(initRate,300,tfInterval),initRate,false);

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
          if(!wsAlive) return; // see the same guard/comment in applyForexCandles above
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

            // Deriv error responses keep the ORIGINAL request's msg_type
            // (e.g. "ticks_history"), not "error" — the error itself only
            // ever shows up in msg.error. Checking msg_type==="error" alone
            // (as this used to) never catches that: verified live that
            // subscribing to frxXAUUSD/frxXAGUSD gets rejected
            // ({error:{code:"InvalidSymbol"}}) with msg_type:"ticks_history",
            // so the code silently kept showing the initial placeholder price
            // forever with no fallback and no visible sign anything failed.
            if(msg.error){
              console.warn("[Deriv WS forex]",msg.error?.message||msg.error);
              // Backfill REAL candle history for the current timeframe —
              // without this, only the live-price poller below ever ran,
              // so the chart kept whatever (placeholder, or a previous
              // timeframe's) candles it already had and switching interval
              // (which tears down and reopens this connection with a new
              // granularity) looked like the chart "lost" data: same bug
              // class as the frozen-price one, just for history instead of
              // the live edge. /api/forex already does this exact job for
              // commodities (cur.yahooTicker) — same endpoint handles forex
              // directly via from/to.
              if(!backfilled){
                backfilled=true;
                (async()=>{
                  try{
                    const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({from:forexFrom,to:forexTo,candles:true,limit:500,interval:tfInterval})});
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
              // Fallback covers BOTH commodity (yahooTicker) and forex
              // (forexFrom/forexTo) symbols — this branch used to only
              // handle commodities, so when Deriv's live subscribe started
              // rejecting forex too (verified live: frxEURUSD's bare
              // ticks_history succeeds, subscribe:1 now gets InvalidSymbol —
              // the same quirk gold/silver had, now hitting all 8 forex
              // pairs), the price just froze on the initial placeholder with
              // no fallback ever kicking in.
              if(!iv){
                iv=setInterval(async()=>{
                  const np=cur.type==="commodity"
                    ? await fetchCommodityRateCached(cur.yahooTicker,5000)
                    : await fetchForexRateCached(forexFrom,forexTo,5000);
                  if(!np||isNaN(np)) return;
                  if(!wsAlive) return; // see the same guard/comment in applyForexCandles above
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
              return;
            }

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
  // Tracks positions currently mid-close so the TP/SL watchers (which re-run
  // on every price tick) can't fire a SECOND Deriv sell for the same
  // contract while the first is still in flight — the async real-money path
  // below no longer removes the position from state synchronously, widening
  // the window where a watcher could otherwise re-trigger it.
  const closingIdsRef=useRef(new Set());
  const closePosition=useCallback(async(posId,currentPrice,reason)=>{
    if(closingIdsRef.current.has(posId)) return;
    closingIdsRef.current.add(posId);
    try{
      const pos=posRef.current.find(p=>p.id===posId);
      if(!pos) return;

      let exitPrice=currentPrice;
      let pnl=effectivePnL(pos,currentPrice,pos.allocatedSize||positionSizeRef.current);
      let commission=pos.commission;
      let closeTimeMs=Date.now();

      // Real money: the close must actually succeed on Deriv BEFORE we touch
      // any local state or history. Previously this fired the Deriv sell
      // without awaiting it and recorded a close using OUR OWN price
      // regardless of whether Deriv's side actually went through — if the
      // sell failed for any reason, the position stayed open on Deriv while
      // the app fabricated a closed trade with a PnL nobody ever realized.
      //
      // Gated on pos.derivContractId ALONE — NOT derivEnabledRef.current.
      // Whether a position is real is a property of the position, not of
      // whatever the arm switch currently sits on. Verified live: clicking
      // "Cerrar" on a manually-discovered real position while Simulado was
      // armed did nothing on Deriv's side at all (this whole branch was
      // skipped) — the exact same phantom-close bug this comment already
      // describes, reintroduced through the arm-switch condition instead of
      // a missing await.
      if(pos.derivContractId){
        const closeResult=await closeDerivOrder(pos.derivContractId);
        if(!closeResult.ok){
          addLog(`⚠️ Deriv rechazó el cierre de ${pos.symbol} (${closeResult.error}) — la posición SIGUE ABIERTA, no se registró ningún cierre`,"sell");
          return;
        }
        // Pull Deriv's own authoritative settlement (exit_spot/profit/commission)
        // instead of trusting our own price feed's snapshot at click-time.
        const detail=await getDerivContract(pos.derivContractId);
        if(detail&&detail.isSold){
          exitPrice=detail.exitSpot??currentPrice;
          pnl=detail.profit??pnl;
          commission=detail.commission??commission;
          closeTimeMs=detail.closeTime??closeTimeMs;
        } else {
          addLog(`ℹ️ Deriv confirmó el cierre de ${pos.symbol} pero aún no hay detalle de liquidación — usando precio local como referencia temporal`,"info");
        }
      }

      deletePositionOpen(pos.id);
      setPositions(prev=>prev.filter(p=>p.id!==posId));
      const posSym=pos.symbol||symbolRef.current;
      const prec=ASSETS[posSym]?.precision||ASSETS[symbolRef.current].precision;
      const emoji=reason==="TP+"?"🚀":reason==="TP"?"✅":reason==="SL"?"🛑":reason==="TRAIL"?"🔒":"⬜";
      addLog(`${emoji} ${reason} ${pos.type} ${posSym} @ ${fP(exitPrice,prec)} → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      setBalance(b=>{const nb=b+pnl;balanceRef.current=nb;return nb;});
      const closedTrade={...pos,exit:exitPrice,pnl,reason,time:now(),tradeTime:Math.floor(closeTimeMs/1000),
        closeTime:closeTimeMs, symbol:posSym, activePatterns:patternsRef.current.map(p=>p.name), commission};
      setTrades(t=>[closedTrade,...t.slice(0,49)]);
      saveTradeLearning(closedTrade);
      setLearningStats(calcLearningStats(loadTrades()));
      // Persist to Postgres too (fire-and-forget) — localStorage above is the
      // instant/offline fallback, this is what makes learning survive a
      // closed browser or a different device. See api/trades.js.
      fetch("/api/trades",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          symbol:closedTrade.symbol, type:closedTrade.type,
          entryPrice:closedTrade.entry, exitPrice, pnl, confidence:pos.confidence??null,
          patterns:closedTrade.activePatterns, closeReason:reason,
          derivContractId:pos.derivContractId, commission,
          allocatedSize:pos.allocatedSize||positionSizeRef.current, multiplier:pos.multiplier||multiplierRef.current,
          openedBy:pos.openedBy||"BOT",
          source:pos.source, correlatedWith:pos.correlatedWith,
          openedAt:closedTrade.openTime?new Date(closedTrade.openTime).toISOString():undefined,
          closedAt:new Date(closeTimeMs).toISOString(),
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
        if(newLosses>=consecutiveLossLimitRef.current){
          // Pause 2 analysis cycles to avoid revenge trading
          skipCyclesRef.current=2; setSkipCycles(2);
          addLog(`⚠️ ${newLosses} SL consecutivos — pausando 2 ciclos para reevaluar tendencia`,"sell");
        }
      } else if(pnl>0){
        consLossesRef.current=0; setConsLosses(0);
      }
      if((reason==="TP"||reason==="TP+")&&autoRef.current){
        pendingAnalysisRef.current=true;
        setAutoPhase("tp_hit_analyzing");
      }
    } finally {
      closingIdsRef.current.delete(posId);
    }
  },[addLog]);

  /* ── TP / SL watcher — active symbol ────────────────────────────────── */
  useEffect(()=>{
    if(!priceVerified) return;
    const peakUpdates=[];
    posRef.current
      .filter(p=>p.symbol===symbol&&!closingIdsRef.current.has(p.id))
      .forEach(pos=>{
        // Each position carries its own tp/sl (scaled for ITS symbol) since
        // multiple symbols can be open at once — falls back to the active
        // symbol's current tpTarget/slTarget only for older positions that
        // predate that field.
        const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
        const pnl=effectivePnL(pos,price,pos.allocatedSize||positionSize);
        const peakPnl=Math.max(pos.peakPnl||0,pnl);
        // extendedStopLevel: TP is no longer a hard ceiling — once peak
        // profit reaches it, the floor keeps rising (giving back only 40%
        // of anything gained beyond TP) so a strong trend can close well
        // above the original target instead of every winner capping there.
        const stopLevel=extendedStopLevel(peakPnl,posTp,posSl);
        if(pnl<=stopLevel){
          closePosition(pos.id,price,stopLevel<0?"SL":peakPnl>=posTp?"TP+":"TRAIL");
        } else if(peakPnl!==(pos.peakPnl||0)) peakUpdates.push({id:pos.id,peakPnl});
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
      .filter(p=>p.symbol&&p.symbol!==symbol&&!closingIdsRef.current.has(p.id))
      .forEach(pos=>{
        const cp=livePrices[pos.symbol];
        const cfg=ASSETS[pos.symbol];
        if(!cp||cp===cfg?.basePrice) return;
        const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
        const pnl=effectivePnL(pos,cp,pos.allocatedSize||positionSize);
        const peakPnl=Math.max(pos.peakPnl||0,pnl);
        const stopLevel=extendedStopLevel(peakPnl,posTp,posSl);
        if(pnl<=stopLevel){
          closePosition(pos.id,cp,stopLevel<0?"SL":peakPnl>=posTp?"TP+":"TRAIL");
        } else if(peakPnl!==(pos.peakPnl||0)) peakUpdates.push({id:pos.id,peakPnl});
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
    const learningSnapshot=calcLearningStats(trades);
    const byPatternStats=learningSnapshot?.byPattern||[];
    const byHourStats=learningSnapshot?.byHour||[];

    // ── Apply the walk-forward-validated tier for this symbol on top of the
    // learning-derived threshold: MIXTO/ROBUSTO raise the bar, SIN-EDGE blocks
    // auto-open outright (see SYMBOL_STRATEGY definition near ASSETS).
    const stratCfg=SYMBOL_STRATEGY[symbolRef.current];
    const symbolAutoDisabled=stratCfg?.tier==="SIN-EDGE";
    // Real-money candidates (Deriv Real + forex) keep the full validated bar;
    // everything else — crypto/commodities, or Simulado mode — is definitely
    // landing in paper trading, so it gets the Simulado discount for faster
    // learning cycles (see SIM_CONFIDENCE_DISCOUNT).
    const couldBeReal=derivEnabledRef.current && ASSETS[symbolRef.current]?.type==="forex";
    if(stratCfg?.minConf!=null){
      const tierMinConf=couldBeReal?stratCfg.minConf:Math.max(SIM_CONFIDENCE_FLOOR,stratCfg.minConf-SIM_CONFIDENCE_DISCOUNT);
      minConf=Math.max(minConf,tierMinConf);
    }

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
        // ── Hour-of-day feedback: same idea, but keyed on the hour this new
        // trade would open at (now), not a historical trade's hour.
        const hourAdj=getHourAdjustment(Date.now(),byHourStats);
        if(hourAdj.delta!==0){
          result.confidence=Math.max(0,Math.min(99,result.confidence+hourAdj.delta));
          result.reasoning=`[Aprendizaje: ${hourAdj.note}, ${hourAdj.delta>0?"+":""}${hourAdj.delta}%] ${result.reasoning}`;
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

      if(autoRef.current||autoRealRef.current){
        const activeSym=symbolRef.current;
        const symSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===activeSym).length;
        if(!symbolAutoDisabled&&result.should_open&&result.signal!=="HOLD"&&symSlots>0&&result.confidence>=minConf){
          const isBuy=result.signal==="BUY";
          const cp=priceRef.current;
          const prec=ASSETS[activeSym].precision;
          const activeAssetCheck=ASSETS[activeSym];
          const ps=positionSizeRef.current;

          // ── Deriv order for forex pairs — the CORRELATED-pairs loop below
          // never sends its own positions to Deriv (only the active symbol
          // ever can), never SIN-EDGE tier, capped at MAX_REAL_POSITIONS real
          // positions open at once, and never a real duplicate of an
          // already-open real bet dressed up as a different symbol (e.g. BUY
          // EUR/USD while already long USD/CHF is the same "USD weakens"
          // bet twice, since they move at -1 correlation).
          let derivContractId=null;
          const activeTier=SYMBOL_STRATEGY[activeSym]?.tier;
          const openRealPositions=posRef.current.filter(p=>p.derivContractId);
          const realPositionsCount=openRealPositions.length;
          const dupSymbol=findCorrelatedRealDuplicate(activeSym,result.signal,openRealPositions);
          // Computed BEFORE the Deriv order so the limit_order sent to Deriv
          // itself matches activeSym's own validated tp/sl, not whatever the
          // generic tpTarget/slTarget sliders happen to be set to (those
          // default to ETH/USDT's numbers — see initTp/initSl — and are
          // shared across every symbol). Found live: every real order's own
          // Deriv-side stop was the SAME $2/$4ish figure regardless of
          // symbol, so Deriv was closing positions at ITS generic target —
          // never reaching the per-symbol validated one — while the app's
          // own tracking (pos.tp/pos.sl below) showed the correct validated
          // number the whole time. Across 102 real trades only ONE ever hit
          // its own TP; the other ~35% that didn't match either target
          // within tolerance landed as unexplained "MANUAL" closes instead
          // of the TP/SL hits they actually were.
          const mainScaled=scaledTpSl(activeSym,ps,multiplierRef.current);
          const realTp=realTpOverrideRef.current??mainScaled?.tp??tpTargetRef.current, realSl=realSlOverrideRef.current??mainScaled?.sl??slTargetRef.current;
          if(autoRealRef.current && derivEnabledRef.current && activeAssetCheck?.type==="forex"){
            // Correlated duplicate is a confidence PENALTY, not a hard block
            // (was one — verified live it mathematically capped real trading
            // at ~2 diversified symbols out of 7 eligible, since just 2
            // opposite-signed positions span every sign combination on the
            // rest via the correlation table). Still needs the reinforced
            // bar to actually go real; blockReasonReal stays null otherwise.
            const sameSymbolRealCount=openRealPositions.filter(p=>p.symbol===activeSym).length;
            let blockReasonReal=null;
            if(activeTier==="SIN-EDGE"||!activeTier) blockReasonReal=`${activeSym} es tier ${activeTier||"desconocido"}`;
            else if(realPositionsCount>=MAX_REAL_POSITIONS) blockReasonReal=`ya hay ${realPositionsCount}/${MAX_REAL_POSITIONS} posiciones reales abiertas`;
            else if(sameSymbolRealCount>=MAX_REAL_POSITIONS_PER_SYMBOL) blockReasonReal=`ya hay ${sameSymbolRealCount}/${MAX_REAL_POSITIONS_PER_SYMBOL} posición real abierta en ${activeSym} — no se apila la misma apuesta`;
            else if(dupSymbol){
              const reinforcedMinConf=Math.min(95,(SYMBOL_STRATEGY[activeSym]?.minConf??minConf)+CORR_DUP_CONFIDENCE_PENALTY);
              if(result.confidence<reinforcedMinConf) blockReasonReal=`${result.signal} ${activeSym} es la misma apuesta que la posición real en ${dupSymbol} (correlacionados) — confianza ${result.confidence}% < umbral reforzado ${reinforcedMinConf}%`;
            }
            if(blockReasonReal){
              addLog(`🔴 Deriv: ${blockReasonReal} — posición registrada en simulación`,"sell");
            } else {
              const dResult=await openDerivOrder(activeSym,result.signal,ps,multiplierRef.current,realTp,realSl);
              if(dResult.ok){
                derivContractId=dResult.contractId;
                addLog(`🔴 Deriv orden REAL ${result.signal} abierta${dupSymbol?` [misma apuesta que ${dupSymbol}, confianza reforzada OK]`:""} | ContractID:${derivContractId} | Stake:$${ps} × ${multiplierRef.current}x @ ${dResult.buyPrice}`,"info");
              } else {
                addLog(`⚠️ Deriv: ${dResult.error} — posición registrada en simulación`,"sell");
              }
            }
          }

          // Nowhere for this signal to land: it didn't become real (Deriv
          // Real AUTO off, not eligible, or the Deriv attempt itself failed)
          // and Simulado AUTO is off too — skip instead of silently falling
          // back to a simulated open nobody asked for.
          if(!derivContractId && !autoRef.current){
            addLog(`⏸ Señal ${result.signal} ${activeSym} calificó pero no se ejecutó — AUTO Deriv Real sin condiciones para ir real y AUTO Simulado está apagado`,"info");
            setAutoPhase("waiting_conditions");
            setAnalyzing(false); pendingAnalysisRef.current=false; return;
          }

          const mainPos={type:result.signal,entry:cp,id:Date.now()+Math.random(),
            symbol:activeSym,openTime:Date.now(),allocatedSize:ps,multiplier:multiplierRef.current,peakPnl:0,
            confidence:result.confidence, source:"MAIN",
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
              // Correlated pairs never go to Deriv — conservative mode only ever
              // sends the ONE active symbol's trade real (see mainPos above),
              // so a signal firing on several correlated pairs at once can't
              // multiply real-money exposure.
              const corrDerivId=null;
              const corrScaled=scaledTpSl(corrSym,ps,multiplierRef.current);
              corrPositions.push({
                type:corrSignal,entry:corrPrice,id:Date.now()+Math.random()+corrPositions.length*0.001,
                symbol:corrSym,openTime:Date.now(),correlatedWith:activeSym,allocatedSize:ps,multiplier:multiplierRef.current,peakPnl:0,
                source:"CORRELATED",
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
     sin gastar una llamada a Groq por símbolo. Mayormente simulado (paper) —
     la EXCEPCIÓN es cuando AUTO Deriv Real + derivEnabled están activos y el
     símbolo en turno es forex (ROBUSTO o MIXTO, nunca SIN-EDGE) con cupo bajo
     MAX_REAL_POSITIONS — mismo gate que el análisis del símbolo activo (ver
     runAnalysis). Si es la misma apuesta que otra posición real ya abierta
     en un símbolo correlacionado, ya NO se bloquea — solo exige
     CORR_DUP_CONFIDENCE_PENALTY puntos más de confianza (antes bloqueaba
     por completo; con solo 8 pares forex ligados al mismo factor de fondo
     -fuerza del dólar-, eso topaba la diversificación real en la práctica a
     ~2 símbolos). SÍ sigue bloqueando por completo apilar MÁS de una
     posición real en el MISMO símbolo (MAX_REAL_POSITIONS_PER_SYMBOL) — en
     producción el bot llegó a abrir 6 BUY reales en AUD/USD a la vez, que
     cerraron todas juntas en pérdida; eso no es diversificación, es la misma
     apuesta multiplicada. Respeta también el cupo por símbolo (MAX_POSITIONS) y
     los cupos GLOBALES INDEPENDIENTES de cada modo — MAX_SIM_POSITIONS y
     MAX_REAL_POSITIONS ya no comparten un solo pool de 10: antes, Simulado
     (más símbolos elegibles + umbral más bajo) llenaba ese pool compartido
     casi de inmediato, dejando a Real sin cupo aunque calificara. */
  const runAutoScan=useCallback(async()=>{
    if(!autoRef.current&&!autoRealRef.current) return;
    const allTrades=loadTrades();
    const learningSnapshot=calcLearningStats(allTrades);
    const byPatternStats=learningSnapshot?.byPattern||[];
    const byHourStats=learningSnapshot?.byHour||[];
    // Tracked locally (not just posRef) so multiple qualifying symbols in the
    // SAME scan pass can't overshoot either pool, or both become the same
    // correlated bet, before posRef re-syncs on render.
    let simCount=posRef.current.filter(p=>!p.derivContractId).length;
    const openRealPositions=posRef.current.filter(p=>p.derivContractId).map(p=>({symbol:p.symbol,type:p.type}));
    if(simCount>=MAX_SIM_POSITIONS && openRealPositions.length>=MAX_REAL_POSITIONS) return; // ambos pools llenos
    for(const [sym,strat] of Object.entries(SYMBOL_STRATEGY)){
      if(strat.tier==="SIN-EDGE") continue;
      if(sym===symbolRef.current) continue; // ya lo cubre el análisis principal
      if(simCount>=MAX_SIM_POSITIONS && openRealPositions.length>=MAX_REAL_POSITIONS) break;
      if(!isMarketOpen(ASSETS[sym]?.type)) continue; // forex/materias cerrados el fin de semana
      const symSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===sym).length;
      if(symSlots<=0) continue;
      const data=assetSignalsRef.current[sym];
      if(!data||data.signal==="HOLD"||!data.confidence) continue;

      // Same two learning feedback loops as the active symbol: this symbol's
      // own recent record (not the global blend) and how its detected
      // patterns have historically performed. Computed BEFORE the confidence
      // check (moved up from below) so we already know whether this
      // candidate would actually land on Deriv Real or in Simulado — a real
      // candidate keeps the full validated bar (plus CORR_DUP_CONFIDENCE_PENALTY
      // if it's the same bet as an already-open real position on a
      // correlated symbol — no longer a hard block, see that constant),
      // everything else gets the Simulado discount for faster learning cycles.
      const dupSymbol=findCorrelatedRealDuplicate(sym,data.signal,openRealPositions);
      const sameSymbolRealCount=openRealPositions.filter(p=>p.symbol===sym).length;
      const willBeReal=autoRealRef.current && derivEnabledRef.current && ASSETS[sym]?.type==="forex" && openRealPositions.length<MAX_REAL_POSITIONS && sameSymbolRealCount<MAX_REAL_POSITIONS_PER_SYMBOL;
      // Neither switch wants this candidate: it wouldn't be real (Deriv Real
      // AUTO off, or not eligible) and Simulado AUTO is off too, so there's
      // nowhere for it to land — skip before spending the minConf/pattern
      // computation on it.
      if(!willBeReal && !autoRef.current) continue;
      if(!willBeReal && simCount>=MAX_SIM_POSITIONS) continue; // aterrizaría en Simulado pero ese pool ya está lleno
      const tierMinConf=willBeReal
        ? Math.min(95,strat.minConf+(dupSymbol?CORR_DUP_CONFIDENCE_PENALTY:0))
        : Math.max(SIM_CONFIDENCE_FLOOR,strat.minConf-SIM_CONFIDENCE_DISCOUNT);
      const baseMinConf=consLossesRef.current>=2?Math.min(95,tierMinConf+10):tierMinConf;
      const minConf=getSymbolMinConf(allTrades,sym,baseMinConf);
      const {delta,note}=getPatternAdjustment(data.patterns,byPatternStats);
      const hourAdj=getHourAdjustment(Date.now(),byHourStats);
      const adjConfidence=Math.max(0,Math.min(99,data.confidence+delta+hourAdj.delta));
      if(adjConfidence<minConf) continue;

      const ps=positionSizeRef.current;

      // Real-money gate — same rule as the active symbol's own analysis
      // path: forex only (already true here, SIN-EDGE already skipped by
      // the loop's own `continue` above) and capped at MAX_REAL_POSITIONS
      // concurrent real positions. A correlated duplicate already had to
      // clear the reinforced confidence bar above to get here.
      let derivContractId=null;
      // Same fix as runAnalysis above: the Deriv-side limit_order must match
      // sym's own validated tp/sl, not the generic tpTarget/slTarget
      // sliders — see the comment there for what went wrong live.
      const scaled=scaledTpSl(sym,ps,multiplierRef.current);
      const realTp=realTpOverrideRef.current??scaled?.tp??tpTargetRef.current, realSl=realSlOverrideRef.current??scaled?.sl??slTargetRef.current;
      if(willBeReal){
        const dResult=await openDerivOrder(sym,data.signal,ps,multiplierRef.current,realTp,realSl);
        if(dResult.ok){
          derivContractId=dResult.contractId;
          openRealPositions.push({symbol:sym,type:data.signal});
          addLog(`🔴 Deriv orden REAL ${data.signal} abierta (auto multi-símbolo)${dupSymbol?` [misma apuesta que ${dupSymbol}, confianza ${adjConfidence}% ≥ umbral reforzado ${minConf}%]`:""} | ContractID:${derivContractId} | ${sym} · Stake:$${ps} × ${multiplierRef.current}x`,"info");
        } else {
          addLog(`⚠️ Deriv: ${dResult.error} — ${sym} registrado en simulación`,"sell");
        }
      }

      // The real attempt above can still fail even when willBeReal was true
      // (Deriv API error) — if Simulado AUTO is off, there's no fallback to
      // record it into, so the signal is simply not taken this cycle.
      if(!derivContractId && !autoRef.current) continue;
      if(!derivContractId) simCount++; // aterrizó en Simulado — incluye el fallback cuando la orden real falló

      const pos={
        type:data.signal, entry:data.price, id:Date.now()+Math.random(),
        symbol:sym, openTime:Date.now(), allocatedSize:ps, multiplier:multiplierRef.current, peakPnl:0,
        confidence:adjConfidence, source:"SCAN",
        tp:scaled?.tp??tpTargetRef.current, sl:scaled?.sl??slTargetRef.current,
        ...(derivContractId&&{derivContractId}),
      };
      setPositions(p=>[...p,pos]);
      savePositionOpen(pos,adjConfidence);
      addLog(`🌐 ${data.signal==="BUY"?"🟢":"🔴"} ${data.signal} ${sym} @ ${fP(data.price,data.prec||5)} (auto multi-símbolo, ${strat.tier}, conf ${adjConfidence}%${note?` · ${note}`:""}${hourAdj.note?` · ${hourAdj.note}`:""})`,data.signal==="BUY"?"buy":"sell");
    }
  },[addLog]);

  /* ── Auto loop ───────────────────────────────────────────────────────── */
  useEffect(()=>{
    clearInterval(timerRef.current);
    clearInterval(countRef.current);
    if(!autoMode&&!autoRealMode){setAutoPhase("idle");setNextAnalysis(null);return;}

    addLog(`🤖 AUTO ACTIVADO (${[autoMode&&"Simulado",autoRealMode&&"Deriv Real"].filter(Boolean).join(" + ")}) — TP:+${fUSD(tpTargetRef.current)} | SL:-${fUSD(slTargetRef.current)} | Máx ${MAX_POSITIONS} pos/símbolo, ${MAX_SIM_POSITIONS} simuladas + ${MAX_REAL_POSITIONS} reales | escaneando todos los símbolos validados`,"info");
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
      if(!autoRef.current&&!autoRealRef.current)return;
      const symCount=posRef.current.filter(p=>p.symbol===symbolRef.current).length;
      if(symCount<MAX_POSITIONS) runAnalysis("Ciclo automático regular");
      else setAutoPhase("monitoring");
      runAutoScan();
    },ANALYSIS_INTERVAL_MS);

    return()=>{clearInterval(timerRef.current);clearInterval(countRef.current);};
  },[autoMode,autoRealMode,runAutoScan]);

  /* ── React to TP hit → re-analyze ───────────────────────────────────── */
  useEffect(()=>{
    if(!pendingAnalysisRef.current||analyzing)return;
    // Soft optimization gate only — runAnalysis itself still checks
    // per-symbol symSlots and, for real orders, MAX_REAL_POSITIONS
    // separately, so this just avoids a pointless re-analysis call once
    // Simulado's own pool is full (real orders aren't gated by this).
    if(autoRef.current&&posRef.current.filter(p=>!p.derivContractId).length<MAX_SIM_POSITIONS){
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
  const unrealized=symPositions.reduce((s,p)=>s+effectivePnL(p,price,p.allocatedSize||positionSize),0);
  const totalUnrealized=positions.reduce((s,p)=>{
    const cp=livePricesRef.current[p.symbol]||price;
    return s+effectivePnL(p,cp,p.allocatedSize||positionSize);
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
      <div style={{display:"flex",minHeight:"100vh",width:"100%"}}>
      <Sidebar activeView={activeView} setActiveView={setActiveView}
        derivEnabled={derivEnabled} derivBalance={derivBalance} derivLoginId={derivLoginId} balance={balance}/>
      <div style={{position:"relative",zIndex:1,flex:1,minWidth:0,padding:"18px 28px"}}>

        {/* HEADER */}
        <div className="header-row" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
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

              {/* ── SINTÉTICOS dropdown — Direccional groundwork, solo precio/gráfico por ahora ── */}
              <div style={{display:"flex",alignItems:"center",gap:5,
                background:ASSETS[symbol]?.type==="synthetic"?`${T.glow}14`:T.dim,
                border:`1px solid ${ASSETS[symbol]?.type==="synthetic"?T.glow:T.border}`,
                borderRadius:7,padding:"4px 8px"}}>
                <span style={{fontSize:7,color:ASSETS[symbol]?.type==="synthetic"?T.accent:T.muted,letterSpacing:2,fontWeight:700}}>◎ SINTÉTICOS</span>
                <select
                  value={ASSETS[symbol]?.type==="synthetic"?symbol:""}
                  onChange={e=>e.target.value&&handleSymbolChange(e.target.value)}
                  style={{
                    background:"transparent",border:"none",
                    color:ASSETS[symbol]?.type==="synthetic"?T.accent:T.muted,
                    cursor:"pointer",fontSize:11,fontWeight:700,outline:"none",
                    minWidth:120,
                  }}>
                  {ASSETS[symbol]?.type!=="synthetic"&&<option value="">Seleccionar...</option>}
                  {Object.entries(ASSETS).filter(([,v])=>v.type==="synthetic").map(([s,v])=>(
                    <option key={s} value={s}>{v.label}</option>
                  ))}
                </select>
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

        {/* MODE SELECTOR — Simulado (paper, learning) vs Deriv Real (real money).
            Both feed the SAME learning (calcLearningStats reads every closed
            trade regardless of source) — this only changes who executes the
            active symbol's forex trade (see the ROBUSTO + 1-at-a-time gate in
            runAnalysis) and what the stats row displays. */}
        <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <button onClick={()=>setDerivEnabled(false)}
            style={{background:!derivEnabled?`${T.accent}14`:"transparent",
              border:`2px solid ${!derivEnabled?T.accent:T.border}`,borderRadius:8,
              padding:"12px 16px",cursor:"pointer",textAlign:"left",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              opacity:!derivEnabled?1:.55}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:!derivEnabled?T.accent:T.muted,letterSpacing:.5}}>🧪 SIMULADO</div>
              <div style={{fontSize:9,color:!derivEnabled?T.accent:T.muted,marginTop:2}}>Paper trading · el bot sigue entrenando su aprendizaje</div>
            </div>
            {!derivEnabled&&<span style={{fontSize:8,fontWeight:700,color:T.bg,background:T.accent,padding:"3px 8px",borderRadius:4,letterSpacing:.5}}>ACTIVO</span>}
          </button>
          <button onClick={()=>setDerivEnabled(true)}
            style={{background:derivEnabled?`${T.red}14`:"transparent",
              border:`2px solid ${derivEnabled?T.red:T.border}`,borderRadius:8,
              padding:"12px 16px",cursor:"pointer",textAlign:"left",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              opacity:derivEnabled?1:.55}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:derivEnabled?T.red:T.muted,letterSpacing:.5}}>🔴 DERIV (REAL)</div>
              <div style={{fontSize:9,color:derivEnabled?"#B3324A":T.muted,marginTop:2}}>Dinero real vía tu cuenta Deriv conectada</div>
            </div>
            {derivEnabled&&<span style={{fontSize:8,fontWeight:700,color:T.bg,background:T.red,padding:"3px 8px",borderRadius:4,letterSpacing:.5}}>ACTIVO</span>}
          </button>
        </div>

        {derivEnabled&&(
          <div style={{background:`${T.red}12`,border:`1px solid ${T.red}50`,borderRadius:8,
            padding:"10px 16px",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:16}}>🔴</span>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.red,letterSpacing:.5}}>DINERO REAL — las operaciones aquí se ejecutan en tu cuenta Deriv</div>
                <div style={{fontSize:9,color:"#B3324A",marginTop:1}}>
                  {derivLoginId?`Cuenta ${derivLoginId} · conectada`:"Conectando con Deriv..."}
                </div>
              </div>
            </div>
            <div style={{fontSize:9,color:"#B3324A",textAlign:"right"}}>⚠️ Solo forex (ROBUSTO/MIXTO)<br/>máx {MAX_REAL_POSITIONS} reales · sin duplicar apuestas correlacionadas</div>
          </div>
        )}

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
              <div className="g4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
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
              <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
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
            <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:8}}>
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
            <div className="g4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
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
            <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
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

        {/* ══════════ VISTA: SEÑALES — watchlist completo ══════════ */}
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
            <div className="split-panel" style={{animation:"fadeUp .3s ease",display:"grid",gridTemplateColumns:"1fr 360px",gap:16,alignItems:"start"}}>
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

              {/* Table header — wrapped (with all rows below, forex + materias
                  primas) in one horizontal-scroll container: 8 fixed-width
                  columns never fit a phone screen, so it scrolls sideways
                  instead of squashing or overflowing the page. */}
              <div className="table-scroll">
              <div style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",
                gap:6,padding:"5px 10px",marginBottom:4,borderBottom:`1px solid ${T.border}40`,minWidth:760}}>
                {["PAR","TENDENCIA","SEÑAL","CONF.","ENTRADA","RANGO STOP · OBJETIVO","PIPS","R/R"].map(h=>(
                  <div key={h} style={{fontSize:7,color:T.muted,letterSpacing:1.5,fontWeight:700}}>{h}</div>
                ))}
              </div>

              {/* Rows */}
              {uniquePairs.map(sym=>{
                const d=buildActiveData(sym)||forexWatch[sym];
                if(!d)return(
                  <div key={sym} style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",minWidth:760,
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
                    onClick={()=>{handleSymbolChange(sym);setActiveView("home");}}
                    style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",minWidth:760,
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
                  <div key={sym} style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",minWidth:760,
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
                    onClick={()=>{handleSymbolChange(sym);setActiveView("home");}}
                    style={{display:"grid",gridTemplateColumns:"110px 84px 80px 70px 90px 200px 60px 60px",minWidth:760,
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
              </div>{/* end table-scroll */}

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

        {/* ══════════ VISTA: HISTÓRICO — abiertas en vivo + cerradas ══════════ */}
        {activeView==="historico"&&(()=>{
          // Scope this whole view to tradingViewFilter — a VIEW-only choice,
          // independent of derivEnabled (which arms/disarms real money).
          // Simulado shows only paper trades, Deriv Real shows only trades
          // that actually hit Deriv (derivContractId present); the ORIGEN
          // badge still exists for when both ever mix. See the toggle right
          // below — switching it never touches derivEnabled.
          const viewPositions=positions.filter(p=>tradingViewFilter?!!p.derivContractId:!p.derivContractId);
          const modeTrades=trades.filter(t=>tradingViewFilter?!!t.derivContractId:!t.derivContractId);
          // Histórico search filters — date range (by close time, falls back
          // to open time for trades still missing one), PAR, TIPO. Purely a
          // narrowing view over modeTrades, same pattern as tradingViewFilter.
          const histSymbolOptions=[...new Set(modeTrades.map(t=>t.symbol))].sort();
          const fromMs=histFrom?new Date(histFrom+"T00:00:00").getTime():null;
          const toMs=histTo?new Date(histTo+"T23:59:59").getTime():null;
          const viewTrades=modeTrades.filter(t=>{
            const ts=t.closeTime||t.openTime;
            if(fromMs!=null&&(!ts||ts<fromMs)) return false;
            if(toMs!=null&&(!ts||ts>toMs)) return false;
            if(histSymbol&&t.symbol!==histSymbol) return false;
            if(histType&&t.type!==histType) return false;
            return true;
          });
          const closedWins=viewTrades.filter(t=>t.pnl>0).length;
          const closedLosses=viewTrades.filter(t=>t.pnl<=0).length;
          const totalClosedPnl=viewTrades.reduce((s,t)=>s+(t.pnl||0),0);
          return(
            <div style={{animation:"fadeUp .3s ease"}}>

              {/* Viendo: — puramente qué tabla se muestra, NUNCA arma/desarma
                  dinero real (eso es el selector SIMULADO/DERIV REAL de arriba,
                  derivEnabled). Antes esta vista reusaba derivEnabled también
                  como filtro, así que solo entrar a mirar el modo contrario
                  desarmaba el trading real sin querer. */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                <span style={{fontSize:9,color:T.muted,letterSpacing:1}}>VIENDO:</span>
                <button onClick={()=>setTradingViewFilter(false)}
                  style={{background:!tradingViewFilter?`${T.accent}18`:"transparent",
                    border:`1px solid ${!tradingViewFilter?T.accent:T.border}`,borderRadius:20,
                    padding:"4px 14px",cursor:"pointer",fontSize:10,fontWeight:700,
                    color:!tradingViewFilter?T.accent:T.muted}}>🧪 Simulado</button>
                <button onClick={()=>setTradingViewFilter(true)}
                  style={{background:tradingViewFilter?`${T.red}18`:"transparent",
                    border:`1px solid ${tradingViewFilter?T.red:T.border}`,borderRadius:20,
                    padding:"4px 14px",cursor:"pointer",fontSize:10,fontWeight:700,
                    color:tradingViewFilter?T.red:T.muted}}>🔴 Deriv Real</button>
                {tradingViewFilter!==derivEnabled&&(
                  <span style={{fontSize:9,color:T.orange}}>
                    ⚠ estás viendo {tradingViewFilter?"Deriv Real":"Simulado"}, pero el trading en vivo está armado en {derivEnabled?"Deriv Real":"Simulado"}
                  </span>
                )}
              </div>

              {/* Resumen */}
              <div className="g5" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>ABIERTAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.accent}}>{viewPositions.length}</div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:4}}>CERRADAS</div>
                  <div className="mono" style={{fontSize:16,fontWeight:700,color:T.text}}>{viewTrades.length}</div>
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
                {viewPositions.length===0?(
                  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"20px",textAlign:"center",fontSize:11,color:T.muted}}>
                    {tradingViewFilter?"Sin posiciones reales abiertas en Deriv ahora mismo.":"Sin posiciones abiertas ahora mismo."}
                  </div>
                ):(
                  <div className="table-scroll">
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{display:"grid",gridTemplateColumns:"110px 70px 90px 90px 70px 100px 100px 100px 85px 65px 90px 70px",
                      gap:10,padding:"0 14px 6px",fontSize:10,color:T.text,letterSpacing:1.5,fontWeight:700,minWidth:1150}}>
                      <div>PAR</div><div>TIPO</div><div>ENTRADA</div><div>ACTUAL</div><div>%</div>
                      <div>OBJETIVO</div><div>STOP</div><div>PNL</div><div>VOL/COMISIÓN</div><div>ORIGEN</div><div>ESTADO</div><div></div>
                    </div>
                    {viewPositions.map(pos=>{
                      const posSym=pos.symbol||symbol;
                      const cfg=ASSETS[posSym];
                      const prec=cfg?.precision||5;
                      // Deriv's own current_spot (refreshed every sync) for a real
                      // position — keeps the % column consistent with the PNL
                      // column, which already prefers Deriv's own profit.
                      const livePrice=pos.derivSpot??(posSym===symbol?price:(livePrices[posSym]??cfg?.basePrice));
                      const ps=pos.allocatedSize||positionSize;
                      const mult=pos.multiplier||multiplier;
                      const pnl=effectivePnL(pos,livePrice,ps);
                      const isBuy=pos.type==="BUY";
                      const dir=isBuy?1:-1;
                      const col=pnl>=0?T.green:T.red;
                      const dirCol=isBuy?T.green:T.red; // fixed by direction — never confuse with col (win/loss)
                      const pctChange=dir*(livePrice-pos.entry)/pos.entry*100;
                      const elapsedMin=Math.floor((Date.now()-(pos.openTime||Date.now()))/60000);
                      const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
                      const peakPnl=Math.max(pos.peakPnl||0,pnl);
                      const isProtected=peakPnl>=posTp*TRAIL_BREAKEVEN_AT;
                      const isExtending=peakPnl>=posTp; // past the original target — no longer a hard cap, floor keeps rising
                      const floorUsd=isProtected?extendedStopLevel(peakPnl,posTp,posSl):null;
                      // Convert the $ TP/SL (or the locked-in floor) into the actual
                      // price this symbol needs to reach — inverse of posPnL().
                      const priceFor=usd=>pos.entry*(1+dir*usd/(ps*mult));
                      const tpPrice=priceFor(posTp);
                      const stopPrice=isProtected?priceFor(floorUsd):priceFor(-posSl);
                      const volumen=ps*mult; // notional exposure — stake × multiplier
                      return(
                        <div key={pos.id} className="fade-up" style={{display:"grid",gridTemplateColumns:"110px 70px 90px 90px 70px 100px 100px 100px 85px 65px 90px 70px",
                          gap:10,alignItems:"center",background:`${col}08`,border:`1px solid ${col}35`,borderRadius:8,padding:"10px 14px",minWidth:1150}}>
                          <div>
                            <span style={{fontSize:12,fontWeight:700,color:T.text}}>{posSym}</span>
                            {pos.derivContractId&&<div style={{fontSize:7,color:T.red,marginTop:1}}>#{String(pos.derivContractId)}</div>}
                          </div>
                          <span style={{fontSize:10,fontWeight:700,color:dirCol}}>{isBuy?"▲ BUY":"▼ SELL"}</span>
                          <span className="mono" style={{fontSize:11,color:T.muted}}>{fP(pos.entry,prec)}</span>
                          <span className="mono" style={{fontSize:11,color:T.text}}>{fP(livePrice,prec)}</span>
                          <span className="mono" style={{fontSize:11,fontWeight:700,color:col}}>{fPct(pctChange)}</span>
                          <div>
                            <div className="mono" style={{fontSize:12,fontWeight:700,color:T.green}}>{isExtending?fP(livePrice,prec):fP(tpPrice,prec)}</div>
                            <div style={{fontSize:7,color:T.green,opacity:.75}}>{isExtending?`🚀 extendiendo (base +${fUSD(posTp,false)})`:`+${fUSD(posTp,false)}`}</div>
                          </div>
                          <div>
                            <div className="mono" style={{fontSize:12,fontWeight:700,color:isProtected?T.green:T.red}}>{fP(stopPrice,prec)}</div>
                            <div style={{fontSize:7,color:isProtected?T.green:T.red,opacity:.75}}>{isProtected?`≥${fUSD(floorUsd,false)}`:`-${fUSD(posSl,false)}`}</div>
                          </div>
                          <span className="mono" style={{fontSize:14,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
                          <div>
                            <div className="mono" style={{fontSize:11,fontWeight:700,color:T.text}}>${volumen.toFixed(0)}</div>
                            <div style={{fontSize:7,color:pos.commission!=null?T.red:T.muted,opacity:.85}}>
                              {pos.commission!=null?`com. $${pos.commission.toFixed(2)}`:"sin comisión"}
                            </div>
                          </div>
                          <div>
                            <span style={{fontSize:8,fontWeight:700,color:T.bg,
                              background:pos.derivContractId?T.red:T.accent,padding:"2px 7px",borderRadius:4,
                              textAlign:"center",width:"fit-content"}}>
                              {pos.derivContractId?"DERIV":"SIM"}
                            </span>
                            {pos.openedBy==="MANUAL"&&<div style={{fontSize:7,color:T.orange,marginTop:2}}>✋ manual</div>}
                          </div>
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
                  </div>
                )}
              </div>

              {/* Histórico de cerradas */}
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.text,letterSpacing:1,marginBottom:10}}>HISTÓRICO — GANANCIAS Y PÉRDIDAS</div>

                {/* Filtros de búsqueda — fecha, PAR, TIPO. Narrowing-only sobre modeTrades (sim/real ya elegido arriba). */}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px"}}>
                  <label style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:7,color:T.muted,letterSpacing:1}}>DESDE</span>
                    <input type="date" value={histFrom} onChange={e=>setHistFrom(e.target.value)}
                      style={{background:T.dim,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:10,padding:"5px 7px"}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:7,color:T.muted,letterSpacing:1}}>HASTA</span>
                    <input type="date" value={histTo} onChange={e=>setHistTo(e.target.value)}
                      style={{background:T.dim,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:10,padding:"5px 7px"}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:7,color:T.muted,letterSpacing:1}}>PAR</span>
                    <select value={histSymbol} onChange={e=>setHistSymbol(e.target.value)}
                      style={{background:T.dim,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:10,padding:"5px 7px",minWidth:110}}>
                      <option value="">Todos</option>
                      {histSymbolOptions.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:7,color:T.muted,letterSpacing:1}}>TIPO</span>
                    <select value={histType} onChange={e=>setHistType(e.target.value)}
                      style={{background:T.dim,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:10,padding:"5px 7px"}}>
                      <option value="">Todos</option>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </label>
                  {(histFrom||histTo||histSymbol||histType)&&(
                    <button onClick={()=>{setHistFrom("");setHistTo("");setHistSymbol("");setHistType("");}}
                      style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"6px 10px",cursor:"pointer"}}>
                      ✕ Limpiar filtros
                    </button>
                  )}
                  <div style={{marginLeft:"auto",fontSize:10,color:T.muted,textAlign:"right"}}>
                    {viewTrades.length} operación{viewTrades.length!==1?"es":""}
                    {viewTrades.length>0&&<> · <span style={{color:viewTrades.reduce((s,t)=>s+(t.pnl||0),0)>=0?T.green:T.red,fontWeight:700}}>{fUSD(viewTrades.reduce((s,t)=>s+(t.pnl||0),0))}</span></>}
                  </div>
                </div>

                {viewTrades.length===0?(
                  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"20px",textAlign:"center",fontSize:11,color:T.muted}}>
                    {modeTrades.length===0
                      ?(tradingViewFilter?"Sin operaciones reales cerradas en Deriv todavía.":"Sin operaciones cerradas todavía.")
                      :"Ninguna operación coincide con estos filtros."}
                  </div>
                ):(
                  <div className="table-scroll">
                    <div style={{display:"grid",gridTemplateColumns:"95px 95px 90px 70px 90px 90px 90px 90px 85px 60px 1fr",gap:10,padding:"0 14px 6px",fontSize:7,color:T.muted,letterSpacing:1.5,fontWeight:700,minWidth:1100}}>
                      <div>APERTURA</div><div>CIERRE</div><div>PAR</div><div>TIPO</div><div>ENTRADA</div><div>SALIDA</div><div>PNL</div><div>MOTIVO</div><div>VOL/COMISIÓN</div><div>ORIGEN</div><div>PATRONES</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:1100}}>
                      {viewTrades.slice(0,200).map((t,i)=>{
                        const prec=ASSETS[t.symbol]?.precision||5;
                        const win=t.pnl>0;
                        const col=win?T.green:T.red;
                        const volumen=(t.allocatedSize||0)*(t.multiplier||0);
                        return(
                          <div key={i} style={{display:"grid",gridTemplateColumns:"95px 95px 90px 70px 90px 90px 90px 90px 85px 60px 1fr",
                            gap:10,alignItems:"center",background:T.card,border:`1px solid ${col}25`,borderRadius:7,padding:"9px 14px",minWidth:1100}}>
                            <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.openTime)}</span>
                            <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.closeTime||(t.tradeTime?t.tradeTime*1000:null))}</span>
                            <span style={{fontSize:10,fontWeight:700,color:T.text}}>{t.symbol||symbol}</span>
                            <span style={{fontSize:9,fontWeight:700,color:t.type==="BUY"?T.green:T.red}}>{t.type}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(t.entry,prec)}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(t.exit,prec)}</span>
                            <span className="mono" style={{fontSize:11,fontWeight:700,color:col}}>{fUSD(t.pnl)}</span>
                            <span style={{fontSize:8,fontWeight:700,color:col,background:`${col}18`,padding:"2px 7px",borderRadius:4,textAlign:"center"}}>{t.reason||"—"}</span>
                            <div>
                              <div className="mono" style={{fontSize:10,fontWeight:700,color:T.text}}>{volumen?`$${volumen.toFixed(0)}`:"—"}</div>
                              <div style={{fontSize:7,color:t.commission!=null?T.red:T.muted}}>
                                {t.commission!=null?`com. $${t.commission.toFixed(2)}`:"sin comisión"}
                              </div>
                            </div>
                            <div>
                              <span style={{fontSize:8,fontWeight:700,color:T.bg,
                                background:t.derivContractId?T.red:T.accent,padding:"2px 7px",borderRadius:4,textAlign:"center",width:"fit-content"}}>
                                {t.derivContractId?"DERIV":"SIM"}
                              </span>
                              {t.openedBy==="MANUAL"&&<div style={{fontSize:7,color:T.orange,marginTop:1}}>✋ manual</div>}
                            </div>
                            <span style={{fontSize:9,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {(t.activePatterns||[]).join(", ")||"—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {viewTrades.length>200&&(
                  <div style={{fontSize:9,color:T.muted,textAlign:"center",marginTop:8}}>
                    Mostrando 200 de {viewTrades.length} — ajusta los filtros para acotar más.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ══════════ VISTA: HOME — gráfico del símbolo activo ══════════ */}
        {activeView==="home"&&(<>

        <div className="split-panel" style={{display:"grid",gridTemplateColumns:"1fr 380px",gap:16,alignItems:"start"}}>
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
                      confidence:aiResult.confidence, source:"MAIN",
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
                  :`${symbol}: ventaja inconsistente entre folds de validación — umbral elevado en Deriv Real (≥${SYMBOL_STRATEGY[symbol].minConf}%); en Simulado baja a ≥${Math.max(SIM_CONFIDENCE_FLOOR,SYMBOL_STRATEGY[symbol].minConf-SIM_CONFIDENCE_DISCOUNT)}%.`}
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
        <div className="g6" style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:7,marginBottom:4}}>
          {[
            derivEnabled
              ?{l:"BALANCE DERIV", v:derivBalance!=null?`$${derivBalance.toFixed(2)}`:"…", c:T.red}
              :{l:"BALANCE",       v:`$${balance.toFixed(0)}`,  c:T.accent},
            {l:"NO REALIZ",  v:fUSD(unrealized),           c:unrealized>=0?T.green:T.red},
            {l:"P&L ACUM",   v:fUSD(totalProfit),          c:totalProfit>=0?T.green:T.red},
            {l:"CERRADAS",   v:closedCount,                c:T.yellow},
            {l:"WIN RATE",   v:`${winRate}%`,              c:winRate>=50?T.green:T.red},
            {l:"POSICIONES", v:`${symPositions.length}/${MAX_POSITIONS}`, c:T.text},
          ].map(({l,v,c})=>(
            <div key={l} style={{background:T.card,border:`1px solid ${derivEnabled?`${T.red}30`:T.border}`,borderRadius:6,padding:"7px 10px",textAlign:"center"}}>
              <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:2}}>{l}</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:9,color:derivEnabled?"#B3324A":T.muted,marginBottom:10}}>
          {derivEnabled?"🔴 Balance leído en vivo desde la API de Deriv — no simulado":"📊 Cifras simuladas — sin dinero real involucrado"}
        </div>

        {/* INDICATORS */}
        <TechnicalPanel symbol={symbol} price={price} rsi={rsi} macd={macd} bb={bb}
          ema9={ema9} ema21={ema21} volTrend={volTrend} trend1h={trend1h} precision={asset.precision}/>

        {/* CHART — Lightweight Charts */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:10}}>
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
              <span style={{color:"#007A8A60"}}>··· BB</span>
              <span style={{color:"#00875A70"}}>··· S</span>
              <span style={{color:"#D8112F70"}}>··· R</span>
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
        {(autoMode||autoRealMode)&&(
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
                // Each position needs ITS OWN symbol's live price here, not the
                // on-screen symbol's `price` — using the wrong symbol's price
                // against a very different entry produced absurd PnL (e.g. a
                // BTC/USDT position priced against an EUR/GBP-scale number).
                const posSym=pos?.symbol||symbol;
                const posLivePrice=pos?(posSym===symbol?price:(livePrices[posSym]??ASSETS[posSym]?.basePrice)):null;
                const pnl=(pos&&posLivePrice!=null)?effectivePnL(pos,posLivePrice,pos.allocatedSize||positionSize):null;
                const col=pos?(pnl==null?T.muted:pnl>=0?T.green:T.red):T.dim;
                return(
                  <div key={i} style={{flex:1,height:28,border:`1px solid ${col}`,borderRadius:5,background:`${col}12`,
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    {pos?(
                      <>
                        <span style={{fontSize:7,color:col}}>{pos.type}</span>
                        <span className="mono" style={{fontSize:8,color:col}}>{pnl==null?"…":fUSD(pnl)}</span>
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
              <div className="g3" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
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

        {/* CONTROLS — per-symbol manual actions. AUTO Simulado/Deriv Real
            toggles, el inicio programado y la gestión de capital viven ahora
            en Configuración (una sola fuente de verdad para "¿está prendido
            el bot?", en vez de repetirlo por cada símbolo). */}
        <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <button onClick={()=>runAnalysis("Análisis manual")} disabled={analyzing}
            style={{background:analyzing?T.dim:`${T.accent}14`,border:`1px solid ${analyzing?T.border:T.accent}`,
              color:analyzing?T.muted:T.accent,borderRadius:8,padding:"11px 8px",cursor:analyzing?"not-allowed":"pointer",fontSize:12,fontWeight:700}}>
            {analyzing?"⏳ Analizando...":"🔍 Analizar IA"}
          </button>
          <button onClick={()=>loadNews(symbol)} disabled={loadingNews}
            style={{background:loadingNews?T.dim:`${T.yellow}10`,border:`1px solid ${loadingNews?T.border:T.yellow}`,
              color:loadingNews?T.muted:T.yellow,borderRadius:8,padding:"11px 8px",cursor:loadingNews?"not-allowed":"pointer",fontSize:12,fontWeight:700}}>
            {loadingNews?"⏳ Cargando...":"📰 Actualizar Noticias"}
          </button>
        </div>
        {!autoMode&&!autoRealMode&&(
          <div style={{fontSize:9,color:T.orange,marginBottom:10}}>
            ⚪ AUTO está apagado — actívalo en Configuración → Automatización para que el bot opere solo.
          </div>
        )}

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
                <div className="g3" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
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
              <div className="g5" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
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
              {/* Hour-of-day performance — mirrors getHourAdjustment's own formula/threshold
                  (t>=10, ±1.5×(wr-50) capped at -10/+6) so what's drawn here is exactly what
                  the bot is actually applying, not just a display-only stat. */}
              {learningStats.byHour?.length>0&&(()=>{
                const byH={}; learningStats.byHour.forEach(h=>{byH[h.hour]=h;});
                const hours=Array.from({length:24},(_,h)=>{
                  const s=byH[h]||{hour:h,wr:0,t:0,pnl:0};
                  const delta=s.t>=10?Math.max(-10,Math.min(6,Math.round((s.wr-50)*1.5))):0;
                  return {...s,delta};
                });
                const withDelta=hours.filter(h=>h.delta!==0);
                const best=withDelta.length?withDelta.reduce((a,b)=>b.delta>a.delta?b:a):null;
                const worst=withDelta.length?withDelta.reduce((a,b)=>b.delta<a.delta?b:a):null;
                return (
                  <div>
                    <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:5}}>RENDIMIENTO POR HORA (UTC)</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:2,height:46}}>
                      {hours.map(h=>{
                        const hasData=h.t>=10;
                        const barColor=!hasData?T.border:h.wr>=55?T.green:h.wr<=40?T.red:T.yellow;
                        const heightPct=h.t>0?Math.max(8,h.wr):4;
                        return (
                          <div key={h.hour}
                            title={`${h.hour}h UTC · ${h.t} trades · WR ${h.wr}% · PnL ${fUSD(h.pnl)}${h.delta?` · ajuste ${h.delta>0?"+":""}${h.delta}%`:h.t>0&&h.t<10?" · muestra insuficiente (<10)":""}`}
                            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"default"}}>
                            <div style={{width:"100%",height:34,display:"flex",alignItems:"flex-end"}}>
                              <div style={{width:"100%",height:`${heightPct}%`,background:barColor,borderRadius:2,
                                opacity:hasData?1:0.35,transition:"height .4s"}}/>
                            </div>
                            <span style={{fontSize:6,color:T.muted}}>{h.hour}</span>
                          </div>
                        );
                      })}
                    </div>
                    {(best||worst)&&(
                      <div style={{fontSize:8,color:T.muted,marginTop:4}}>
                        {best&&<span style={{color:T.green}}>▲ mejor: {best.hour}h UTC ({best.delta>0?"+":""}{best.delta}% conf., {best.wr}% WR, {best.t} trades)</span>}
                        {best&&worst&&"  ·  "}
                        {worst&&<span style={{color:T.red}}>▼ peor: {worst.hour}h UTC ({worst.delta}% conf., {worst.wr}% WR, {worst.t} trades)</span>}
                      </div>
                    )}
                  </div>
                );
              })()}
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
                    <span style={{fontSize:8,color:(t.reason==="TP"||t.reason==="TP+")?T.green:t.reason==="SL"?T.red:T.muted,
                      background:`${(t.reason==="TP"||t.reason==="TP+")?T.green:t.reason==="SL"?T.red:T.muted}15`,
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

        </>)}{/* end home (chart) view */}

        {/* ══════════ VISTA: CONFIGURACIÓN ══════════ */}
        {activeView==="config"&&(()=>{
          const todayStr=new Date().toDateString();
          const todayPnl=trades.filter(t=>t.closeTime&&new Date(t.closeTime).toDateString()===todayStr).reduce((s,t)=>s+(t.pnl||0),0);
          const openRealPositions=positions.filter(p=>p.derivContractId);
          // Mismo cálculo de trailing que ya corre en Histórico (isProtected/
          // floorUsd) — aquí solo se muestra, no se recalcula la lógica.
          const trailingRows=openRealPositions.map(pos=>{
            const posSym=pos.symbol||symbol;
            const cfg=ASSETS[posSym];
            const livePrice=pos.derivSpot??(posSym===symbol?price:(livePrices[posSym]??cfg?.basePrice));
            const ps=pos.allocatedSize||positionSize;
            const pnl=effectivePnL(pos,livePrice,ps);
            const posTp=pos.tp??tpTarget, posSl=pos.sl??slTarget;
            const peakPnl=Math.max(pos.peakPnl||0,pnl);
            const isProtected=peakPnl>=posTp*TRAIL_BREAKEVEN_AT;
            const floorUsd=isProtected?extendedStopLevel(peakPnl,posTp,posSl):null;
            const progressPct=Math.max(0,Math.min(100,(peakPnl/(posTp*TRAIL_BREAKEVEN_AT))*100));
            return{pos,posSym,pnl,posTp,posSl,isProtected,floorUsd,progressPct};
          });
          // Calibración — ¿la confianza reportada predice el resultado real?
          // Requiere confidence persistido en trades (ver api/trades.js).
          const confBuckets=[{l:"60–69%",lo:60,hi:70},{l:"70–79%",lo:70,hi:80},{l:"80%+",lo:80,hi:101}];
          const calibRows=confBuckets.map(b=>{
            const sub=trades.filter(t=>t.confidence!=null&&t.confidence>=b.lo&&t.confidence<b.hi);
            const wins=sub.filter(t=>t.pnl>0).length;
            return{...b,n:sub.length,wr:sub.length?Math.round(wins/sub.length*100):null};
          });
          const lastUpdated=Object.values(SYMBOL_STRATEGY).map(s=>s.updatedAt).filter(Boolean).sort().at(-1);

          return(
          <div className="fade-up" style={{display:"flex",flexDirection:"column",gap:16,maxWidth:1320}}>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}} className="g2">

              {/* AUTOMATIZACIÓN */}
              <ConfigCard title="AUTOMATIZACIÓN">
                <div style={{borderTop:`1px solid ${T.border}`,marginTop:-1}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0"}}>
                  <div><div style={{fontSize:12,fontWeight:600}}>AUTO Simulado</div>
                    <div style={{fontSize:9,color:T.muted}}>Opera en papel en todos los símbolos validados</div></div>
                  <ConfigToggle on={autoMode} onClick={()=>setAutoMode(p=>{if(p&&!autoRealMode){setAutoPhase("idle");setNextAnalysis(null);}return!p;})}/>
                </div>
                <ConfigRow>
                  <div><div style={{fontSize:12,fontWeight:600}}>AUTO Crecimiento (real)</div>
                    <div style={{fontSize:9,color:T.muted}}>Multiplicadores con dinero en Deriv</div></div>
                  <ConfigToggle on={autoRealMode} onClick={()=>setAutoRealMode(p=>{if(p&&!autoMode){setAutoPhase("idle");setNextAnalysis(null);}return!p;})}/>
                </ConfigRow>
                <ConfigRow>
                  <div><div style={{fontSize:12,fontWeight:600,color:T.muted}}>AUTO Direccional (real)</div>
                    <div style={{fontSize:9,color:T.muted}}>Rise/Fall — aún sin construir</div></div>
                  <ConfigToggle on={false} onClick={()=>{}}/>
                </ConfigRow>
                <div style={{marginTop:10}}>
                  <SchedulePanel scheduledStart={scheduledStart} setScheduledStart={setScheduledStart}
                    scheduleInput={scheduleInput} setScheduleInput={setScheduleInput}
                    scheduleRemainingMs={scheduleRemainingMs} autoMode={autoMode} addLog={addLog}/>
                </div>
              </ConfigCard>

              {/* CONEXIÓN DERIV */}
              <ConfigCard title="CONEXIÓN DERIV">
                <div style={{fontSize:9,color:T.muted,marginTop:-4,marginBottom:8}}>Una sola cuenta — Crecimiento y Direccional comparten este saldo real.</div>
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Cuenta</span><span className="mono" style={{fontSize:11,fontWeight:700}}>{derivLoginId||"—"}</span></ConfigRow>
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Balance (API Deriv)</span><span className="mono" style={{fontSize:12,fontWeight:700}}>{derivBalance!=null?`$${derivBalance.toFixed(2)}`:"—"}</span></ConfigRow>
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Estado</span>
                  <span style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:derivEnabled?T.green:T.muted,fontWeight:600}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:derivEnabled?T.green:T.border}}/>
                    {derivEnabled?"Armado (dinero real)":"Desarmado (Simulado activo)"}
                  </span>
                </ConfigRow>
                {derivConnectErr&&<ConfigRow><span style={{fontSize:10,color:T.red}}>{derivConnectErr}</span></ConfigRow>}
              </ConfigCard>
            </div>

            {/* GESTIÓN DE RIESGO */}
            <ConfigCard title="GESTIÓN DE RIESGO">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:18,alignItems:"end"}} className="g3">
                <ConfigField label="PÉRDIDA MÁXIMA DIARIA (USD)" type="number" step="1" value={dailyMaxLoss}
                  onChange={e=>setDailyMaxLoss(parseFloat(e.target.value)||0)}/>
                <ConfigField label="PÉRDIDAS SEGUIDAS ANTES DE PAUSAR" type="number" step="1" min="1" value={consecutiveLossLimit}
                  onChange={e=>setConsecutiveLossLimit(Math.max(1,parseInt(e.target.value,10)||1))}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontSize:11,fontWeight:600}}>Detener AUTO al llegar al límite</div>
                    <div style={{fontSize:8,color:T.muted}}>Aplica a Crecimiento y Direccional</div></div>
                  <ConfigToggle on={riskStopEnabled} onClick={()=>setRiskStopEnabled(p=>!p)}/>
                </div>
              </div>
              <div style={{marginTop:10,fontSize:9,color:T.muted}}>
                P&amp;L de hoy: <span style={{color:todayPnl>=0?T.green:T.red,fontWeight:700}}>{fUSD(todayPnl)}</span>
                {" "}· {consecutiveLosses} pérdida{consecutiveLosses!==1?"s":""} seguida{consecutiveLosses!==1?"s":""} ahora mismo
              </div>
            </ConfigCard>

            {/* GESTIÓN DE CAPITAL */}
            <div>
              <div style={{fontSize:8,color:T.muted,letterSpacing:2,fontWeight:700,marginBottom:11}}>💰 GESTIÓN DE CAPITAL</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}} className="g3">

                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:16,display:"flex",flexDirection:"column",gap:11}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <b style={{fontSize:11}}>SIMULADO</b>
                    <span style={{fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:5,background:T.dim,color:T.muted}}>LOCAL · SIN API</span>
                  </div>
                  <div style={{fontSize:9,color:T.muted}}>Aquí el bot aprende sobre papel — TP/SL 100% automáticos, sin edición manual, para no ensuciar el aprendizaje.</div>
                  <CapitalPanel initialCapital={initialCapital} setInitialCapital={setInitialCapital}
                    positionSize={positionSize} setPositionSize={setPositionSize}
                    stakeAutoScale={stakeAutoScale} setStakeAutoScale={setStakeAutoScale}
                    stakeStep={stakeStep} setStakeStep={setStakeStep}
                    stakeGrowthTrigger={stakeGrowthTrigger} setStakeGrowthTrigger={setStakeGrowthTrigger}
                    minStake={minStake} setMinStake={setMinStake}/>
                </div>

                <div style={{background:T.card,border:`1px solid ${T.border}`,borderTop:`2px solid ${T.glow}`,borderRadius:10,padding:16,display:"flex",flexDirection:"column",gap:11}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <b style={{fontSize:11}}>CRECIMIENTO</b>
                    <span style={{fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:5,background:`linear-gradient(135deg,${T.glow},#C9962B)`,color:"#1E1A10"}}>🔗 API DERIV</span>
                  </div>
                  <div style={{fontSize:9,color:T.muted}}>Multiplicadores — usa el saldo real de Deriv. Deja TP/SL vacío para que siga el valor validado por símbolo.</div>
                  <ConfigField label="BALANCE (DERIV, EN VIVO)" value={derivBalance!=null?`$${derivBalance.toFixed(2)}`:"—"} readOnly/>
                  <div style={{display:"flex",gap:8}}>
                    <ConfigField label="TAKE PROFIT (USD)" type="number" step="0.5" placeholder="auto"
                      value={realTpOverride??""} onChange={e=>setRealTpOverride(e.target.value===""?null:parseFloat(e.target.value))}/>
                    <ConfigField label="STOP LOSS (USD)" type="number" step="0.5" placeholder="auto"
                      value={realSlOverride??""} onChange={e=>setRealSlOverride(e.target.value===""?null:parseFloat(e.target.value))}/>
                  </div>
                  {(realTpOverride!=null||realSlOverride!=null)&&(
                    <button onClick={()=>{setRealTpOverride(null);setRealSlOverride(null);}}
                      style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:9,padding:"5px 9px",cursor:"pointer",alignSelf:"flex-start"}}>
                      ✕ Volver a automático
                    </button>
                  )}
                  <ConfigField label="STAKE POR OPERACIÓN" value={`$${positionSize.toFixed(2)}`} readOnly/>
                </div>

                <div style={{background:T.card,border:`1px solid ${T.border}`,borderTop:`2px solid ${T.glow}`,borderRadius:10,padding:16,display:"flex",flexDirection:"column",gap:11}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <b style={{fontSize:11}}>DIRECCIONAL</b>
                    <span style={{fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:5,background:`linear-gradient(135deg,${T.glow},#C9962B)`,color:"#1E1A10"}}>🔗 API DERIV</span>
                  </div>
                  <div style={{fontSize:9,color:T.muted}}>Rise/Fall — mismo saldo real, duración fija por operación.</div>
                  <ConfigField label="BALANCE (DERIV, EN VIVO)" value={derivBalance!=null?`$${derivBalance.toFixed(2)}`:"—"} readOnly/>
                  <div style={{display:"flex",gap:8}}>
                    <ConfigField label="STAKE POR OPERACIÓN" value="$5.00" readOnly/>
                    <ConfigField label="DURACIÓN" value="15 min" readOnly/>
                  </div>
                  <ConfigRow>
                    <div><div style={{fontSize:11,fontWeight:600}}>Habilitar Direccional</div>
                      <div style={{fontSize:8,color:T.muted}}>Pendiente de validar — aún sin backtest propio</div></div>
                    <ConfigToggle on={false} onClick={()=>{}}/>
                  </ConfigRow>
                </div>
              </div>
            </div>

            {/* TRAILING EN VIVO — solo Crecimiento */}
            <ConfigCard title="TRAILING EN VIVO · CRECIMIENTO">
              <div style={{fontSize:9,color:T.muted,marginTop:-4,marginBottom:12}}>
                Al llegar al {Math.round(TRAIL_BREAKEVEN_AT*100)}% del TP el SL sube a breakeven y ya no puede volver a pérdida — esto siempre corrió automático, ahora lo ves en vivo.
              </div>
              {trailingRows.length===0?(
                <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>Sin posiciones reales de Crecimiento abiertas ahora mismo.</div>
              ):(
                <div className="table-scroll">
                <div style={{display:"flex",flexDirection:"column",gap:6,minWidth:620}}>
                  <div style={{display:"grid",gridTemplateColumns:"90px 90px 1fr 140px 170px",gap:10,fontSize:7,color:T.muted,letterSpacing:1,fontWeight:700,padding:"0 4px"}}>
                    <div>PAR</div><div>PNL ACTUAL</div><div>PROGRESO A BREAKEVEN</div><div>SL BASE → ACTUAL</div><div>ESTADO</div>
                  </div>
                  {trailingRows.map(({pos,posSym,pnl,posSl,isProtected,floorUsd,progressPct})=>(
                    <div key={pos.id} style={{display:"grid",gridTemplateColumns:"90px 90px 1fr 140px 170px",gap:10,alignItems:"center",
                      background:`${pnl>=0?T.green:T.red}08`,border:`1px solid ${pnl>=0?T.green:T.red}30`,borderRadius:7,padding:"8px 10px"}}>
                      <span style={{fontSize:11,fontWeight:700}}>{posSym}</span>
                      <span className="mono" style={{fontSize:11,fontWeight:700,color:pnl>=0?T.green:T.red}}>{fUSD(pnl)}</span>
                      <div style={{height:5,borderRadius:3,background:T.dim,overflow:"hidden"}}>
                        <div style={{width:`${progressPct}%`,height:"100%",background:`linear-gradient(90deg,${T.glow},#C9962B)`}}/>
                      </div>
                      <span className="mono" style={{fontSize:10}}>-{fUSD(posSl,false)} → {isProtected?<span style={{color:T.green}}>{fUSD(floorUsd)}</span>:`-${fUSD(posSl,false)}`}</span>
                      {isProtected?(
                        <span style={{fontSize:9,fontWeight:700,color:T.green,background:`${T.green}18`,padding:"3px 8px",borderRadius:4,width:"fit-content"}}>🔒 BREAKEVEN ACTIVADO</span>
                      ):(
                        <span style={{fontSize:9,color:T.muted}}>{Math.round(progressPct)}% del camino</span>
                      )}
                    </div>
                  ))}
                </div>
                </div>
              )}
            </ConfigCard>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}} className="g2">

              {/* CALIBRACIÓN Y APRENDIZAJE */}
              <ConfigCard title="CALIBRACIÓN Y APRENDIZAJE">
                <div style={{fontSize:9,color:T.muted,marginTop:-4,marginBottom:8}}>¿La confianza que reporta la IA predice el resultado real?</div>
                {calibRows.map(r=>(
                  <ConfigRow key={r.l}>
                    <span style={{fontSize:11}}>{r.l} confianza</span>
                    <span className="mono" style={{fontSize:11}}>
                      {r.wr==null?"sin datos":<><span style={{color:r.wr>=55?T.green:T.red,fontWeight:700}}>{r.wr}% aciertos</span> <span style={{color:T.muted}}>(n={r.n})</span></>}
                    </span>
                  </ConfigRow>
                ))}
                <ConfigRow><span style={{fontSize:11,color:T.muted}}>Última revalidación (walk-forward)</span>
                  <span style={{fontSize:11,fontWeight:600}}>{lastUpdated?new Date(lastUpdated).toLocaleDateString("es"):"—"}</span></ConfigRow>
              </ConfigCard>

              {/* NOTICIAS Y SEÑALES */}
              <ConfigCard title="NOTICIAS Y SEÑALES">
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Fuente de noticias</span><span style={{fontSize:11,fontWeight:600}}>Alpha Vantage</span></ConfigRow>
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Modelo de análisis</span><span style={{fontSize:11,fontWeight:600}}>Groq · openai/gpt-oss-120b</span></ConfigRow>
                <ConfigRow><span style={{fontSize:12,color:T.muted}}>Símbolos validados (no SIN-EDGE)</span>
                  <span style={{fontSize:11,fontWeight:600}}>{Object.values(SYMBOL_STRATEGY).filter(s=>s.tier!=="SIN-EDGE").length}/{Object.keys(SYMBOL_STRATEGY).length}</span></ConfigRow>
              </ConfigCard>
            </div>

          </div>
          );
        })()}

        {/* ══════════ VISTA: EXPERIMENTO XAUUSD ══════════ Módulo aparte,
            debajo de Configuración en el sidebar (pedido explícito) — no es
            una tarjeta dentro de Configuración, es su propia página. */}
        {activeView==="experimento"&&(()=>{
          // Para posiciones REALES (contractId), prefiere el profit que Deriv
          // reporta de verdad (su propio mark price + comisión acumulada) en
          // vez de nuestro estimado local — reportado en vivo: nuestra tabla
          // mostraba +$9.52 mientras Deriv mostraba -$0.33 para el MISMO
          // contrato. El servidor sincroniza esto cada ~5s en derivProfit.
          // derivProfit/derivSpot son el "ancla real" (incluye comisión) pero
          // solo se refrescan cada ~3-5s — usarlos DIRECTO como el número en
          // pantalla se sentía "congelado" frente al precio en vivo de 1s
          // (reportado: "no refresca... que se mueva el actual igual que
          // Deriv"). En vez de eso, el precio EN VIVO (expPrice, que ya viene
          // de Deriv cada 1s) sigue moviendo la pantalla cada segundo, y el
          // PNL se corrige con el movimiento ocurrido DESDE ese ancla real —
          // mismo número base de Deriv (con su comisión), interpolado en vivo.
          const effExpPnL=(p,livePrice)=>{
            if(p.derivProfit==null||livePrice==null) return posPnL(p,livePrice??p.entry,p.allocatedSize);
            const anchorSpot=p.derivSpot??livePrice;
            const drift=posPnL({...p,entry:anchorSpot},livePrice,p.allocatedSize);
            return p.derivProfit+drift;
          };
          const stackPnl=expPrice!=null?expPositions.reduce((s,p)=>s+effExpPnL(p,expPrice),0):0;
          const volumen=expPositions.reduce((s,p)=>s+p.allocatedSize*(p.multiplier||DEFAULT_MULTIPLIER),0)
            +(expHedgePos?expHedgePos.allocatedSize*(expHedgePos.multiplier||DEFAULT_MULTIPLIER):0);
          // TRADES CERRADOS/WIN RATE/P&L ACUMULADO: de expHourlyStats (el
          // mismo agregado SQL del gráfico de horas, ya filtrado por fecha/
          // símbolo/tipo/resultado), NO de expTrades crudo — antes mostraba
          // SIEMPRE la mezcla completa sin importar el filtro de arriba, y
          // además expTrades solo trae los últimos ~500 (se quedaba corto
          // igual que le pasó al gráfico de horas). Reportado en vivo:
          // "¿lo está haciendo por horas? si lo quiero filtrar por día me
          // muestra?" — ahora sí, filtrar por fecha cambia estos 3 números.
          const expSummary=(expHourlyStats||[]).reduce((a,h)=>({trades:a.trades+h.trades,wins:a.wins+h.wins,pnl:a.pnl+h.pnl}),{trades:0,wins:0,pnl:0});
          const expWr=expSummary.trades?Math.round(expSummary.wins/expSummary.trades*100):null;
          const expTotalPnl=expSummary.pnl;
          // Pide un cierre manual al motor dueño (SOLO el servidor ejecuta en
          // Deriv — ver nota en claimOrCheckOwnership) vía un comando en
          // bot_config que se revisa cada tick, igual que reloadConfig. No
          // cierra nada directamente desde aquí: solo dispara la solicitud.
          // posId identifica la posición por su `id` local (TODA posición lo
          // tiene, sea simulada o real en Deriv) — no por contractId, que solo
          // existe para las reales y dejaría sin forma de cerrar una simulada.
          const requestExpManualClose=(type,posId)=>{
            fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({key:"exp_manual_close_request",value:JSON.stringify({type,posId,requestedAt:Date.now()})})})
              .then(()=>addLog(type==="all"?"🖐️ Cierre manual de TODA la pila solicitado…":`🖐️ Cierre manual solicitado…`,"info"))
              .catch(()=>{});
          };
          // Filtro del Experimento — UNA sola vez aquí arriba, usado tanto por
          // el gráfico de RENDIMIENTO POR HORA como por la tabla de HISTÓRICO
          // más abajo, para que el filtro de PAR (entre otros) afecte a los
          // dos a la vez: "este filtro de horas debe funcionar también con
          // el filtro si selecciono BTC o ORO" — antes el gráfico usaba
          // SIEMPRE todo expTrades sin filtrar, sin importar lo que se
          // eligiera abajo.
          const expHistSymbolOptions=Object.keys(EXP_SYMBOLS);
          const expHasFilters=expHistFrom||expHistTo||expHistSymbol!=="TODOS"||expHistType!=="TODOS"||expHistResult!=="TODOS";
          const expHistTotalPages=Math.max(1,Math.ceil(expHistTotal/50));
          const expHistPageSafe=Math.min(expHistPage,expHistTotalPages);
          return(
          <div className="fade-up" style={{display:"flex",flexDirection:"column",gap:16,maxWidth:1600}}>

            <ConfigCard title={`EXPERIMENTO · PIRÁMIDE ${expSymbol}`} style={{borderTop:`2px solid ${T.yellow}`}}>
              <div style={{fontSize:9,color:T.muted,marginTop:-4,marginBottom:12}}>
                Solo Simulado, aislado del resto del bot: entra en la dirección de la vela de 1m que acaba de cerrar,
                apila otra posición cada +${expAddStep} de la pila. El piso protector es independiente del apilado:
                mientras el pico de la pila no llegue a +${EXP_FLOOR_ARM_AT} es {fUSD(expFloorStart)} (tocarlo cierra todo y
                voltea de dirección); apenas el pico alcanza +${EXP_FLOOR_ARM_AT}, el piso pasa a ser el {Math.round(EXP_RETAIN_PCT*100)}%
                de ese pico y solo sube desde ahí — una vez ahí, siempre cierra en positivo. Volteo rápido: si la
                pila que se acaba de cerrar fue GANADORA, la nueva dirección arranca con un piso mucho más chico
                ({fUSD(expFloorStart*EXP_QUICK_REVERSAL_FRACTION)} en vez de {fUSD(expFloorStart)}) — si resulta ser
                un error, vuelve rápido a la dirección que sí funcionaba en vez de esperar el piso completo otra vez.
                El stake es lo que determina qué tan rápido se mueven estos $: PnL($) = %movimiento_del_precio × stake × 100 —
                con este stake, {expSymbol} necesita moverse <b>{((expAddStep/(expStake*DEFAULT_MULTIPLIER))*100).toFixed(3)}%</b> para
                el próximo apilado/volteo (sube el stake si lo quieres más rápido, es solo Simulado).
                <br/>Precio en vivo cada 1s vía Deriv ({EXP_SYMBOLS[expSymbol]?.deriv}) — el mismo tick que usa el
                servidor para decidir y el mismo venue que ejecutaría de verdad, así el número que ves siempre
                coincide con el que cuenta (antes usaba Binance, que podía diferir del spot de Deriv).
                <br/>Cobertura: si la pila nunca estuvo en positivo y su pérdida llega al {Math.round(EXP_HEDGE_TRIGGER_PCT*100)}%
                de {fUSD(expFloorStart)} ({fUSD(expFloorStart*EXP_HEDGE_TRIGGER_PCT)}), abre una posición contraria aparte
                (mismo stake) — la pila sigue con su piso normal; si su propia pérdida llega al 100% de {fUSD(expFloorStart)}
                se cierra sola (SL propio); si en cambio gana, se absorbe como la nueva pila en vez de cerrarse al voltear.
              </div>

              {/* Filtro compartido — afecta AL MISMO TIEMPO el gráfico de
                  RENDIMIENTO POR HORA de aquí abajo y la tabla de HISTÓRICO
                  más abajo (pedido explícito: "este filtro de horas debe
                  funcionar también con el filtro si selecciono BTC o ORO" —
                  antes el gráfico ignoraba el filtro de PAR). Un solo
                  filtro arriba de todo en vez de uno por sección. */}
              <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"flex-end",marginBottom:10,padding:"8px 10px",background:T.dim,borderRadius:6}}>
                <div>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>DESDE</div>
                  <input type="date" value={expHistFrom} onChange={e=>setExpHistFrom(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 7px",fontSize:10}}/>
                </div>
                <div>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>HASTA</div>
                  <input type="date" value={expHistTo} onChange={e=>setExpHistTo(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 7px",fontSize:10}}/>
                </div>
                <div>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>PAR</div>
                  <select value={expHistSymbol} onChange={e=>setExpHistSymbol(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,fontWeight:600}}>
                    <option value="TODOS">Todos</option>
                    {expHistSymbolOptions.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>TIPO</div>
                  <select value={expHistType} onChange={e=>setExpHistType(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,fontWeight:600}}>
                    <option value="TODOS">Todos</option>
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:3}}>RESULTADO</div>
                  <select value={expHistResult} onChange={e=>setExpHistResult(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,fontWeight:600}}>
                    <option value="TODOS">Todos</option>
                    <option value="GANANCIA">Ganancias</option>
                    <option value="PERDIDA">Pérdidas</option>
                  </select>
                </div>
                {expHasFilters&&(
                  <button onClick={()=>{setExpHistFrom("");setExpHistTo("");setExpHistSymbol("TODOS");setExpHistType("TODOS");setExpHistResult("TODOS");}}
                    style={{background:"transparent",border:`1px solid ${T.border}`,color:T.muted,borderRadius:4,padding:"5px 10px",cursor:"pointer",fontSize:9,fontWeight:600}}>
                    ✕ Limpiar filtros
                  </button>
                )}
                {expHasFilters&&(
                  <div style={{fontSize:9,color:T.muted,marginLeft:"auto",alignSelf:"center"}}>
                    {expHistTotal} coinciden · afecta el gráfico y el histórico de abajo
                  </div>
                )}
              </div>

              {/* RENDIMIENTO POR HORA — pedido explícito: "estudiando cuales
                  son las mejores horas para que este experimento funcione,
                  dado que si veo muy excelente avance pero al parecer es
                  por horas" + "se muestre un gráfico... arriba de símbolo".
                  Mismo estilo de barras que ya usa el bot principal (ver
                  learningStats.byHour más arriba) para que se lea igual,
                  pero en HORA LOCAL del navegador (no UTC) — lo que importa
                  aquí es la hora del reloj del usuario, no normalizar entre
                  dispositivos. Agregado en el SERVIDOR sobre TODO el
                  histórico (expHourlyStats, ver el efecto que lo carga más
                  arriba) — NO sobre expTrades/expFilteredTrades directo:
                  esos solo traen los últimos ~500 trades, y con un piso
                  chico generando muchos por minuto esa ventana cabía
                  entera en 1-2 horas, perdiendo "lo de anoche" (reportado
                  en vivo: "solo me deja ver 2 horas"). Se vuelve a pedir
                  solo cada vez que cambia el filtro o crece expTrades, así
                  el mejor/peor horario sigue siendo dinámico. */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:T.accent,letterSpacing:1,marginBottom:4}}>
                  RENDIMIENTO POR HORA (hora local{expHistSymbol!=="TODOS"?` · ${expHistSymbol}`:""})
                </div>
                {expHourlyStats===null?(
                  <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>Cargando…</div>
                ):expHourlyStats.length===0?(
                  <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>
                    {expHasFilters?"Ningún trade coincide con el filtro de arriba.":"Sin historial todavía — el patrón aparece con los primeros cierres."}
                  </div>
                ):(()=>{
                  const byH={};
                  for(const row of expHourlyStats) byH[row.hour]={t:row.trades,wins:row.wins,pnl:row.pnl};
                  const hours=Array.from({length:24},(_,h)=>{
                    const s=byH[h]||{t:0,wins:0,pnl:0};
                    return {hour:h,t:s.t,wr:s.t?Math.round(s.wins/s.t*100):0,pnl:s.pnl};
                  });
                  const withData=hours.filter(h=>h.t>0);
                  const best=withData.length?withData.reduce((a,b)=>b.pnl>a.pnl?b:a):null;
                  const worst=withData.length?withData.reduce((a,b)=>b.pnl<a.pnl?b:a):null;
                  return(<>
                    <div style={{display:"flex",alignItems:"flex-end",gap:2,height:46}}>
                      {hours.map(h=>{
                        const hasData=h.t>0;
                        const barColor=!hasData?T.border:h.wr>=55?T.green:h.wr<=40?T.red:T.yellow;
                        const heightPct=hasData?Math.max(8,h.wr):4;
                        return(
                          <div key={h.hour}
                            title={`${String(h.hour).padStart(2,"0")}:00 · ${h.t} trade${h.t!==1?"s":""} · WR ${h.wr}% · PNL ${fUSD(h.pnl)}`}
                            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"default"}}>
                            <div style={{width:"100%",height:34,display:"flex",alignItems:"flex-end"}}>
                              <div style={{width:"100%",height:`${heightPct}%`,background:barColor,borderRadius:2,
                                opacity:hasData?1:0.35,transition:"height .4s"}}/>
                            </div>
                            <span style={{fontSize:7,color:T.muted,fontWeight:(h.hour===12||h.hour===17)?700:400}}>{h.hour}</span>
                          </div>
                        );
                      })}
                    </div>
                    {(best||worst)&&(
                      <div style={{fontSize:8,color:T.muted,marginTop:4}}>
                        {best&&<span style={{color:T.green}}>▲ mejor: {String(best.hour).padStart(2,"0")}:00 ({fUSD(best.pnl)}, {best.wr}% WR, {best.t} trades)</span>}
                        {best&&worst&&best.hour!==worst.hour&&"  ·  "}
                        {worst&&worst.hour!==best?.hour&&<span style={{color:T.red}}>▼ peor: {String(worst.hour).padStart(2,"0")}:00 ({fUSD(worst.pnl)}, {worst.wr}% WR, {worst.t} trades)</span>}
                      </div>
                    )}
                  </>);
                })()}
              </div>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:11,borderBottom:`1px solid ${T.border}`,marginBottom:11}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Símbolo</div>
                  <div style={{fontSize:8,color:T.muted}}>
                    {(expPositions.length>0||expHedgePos)?"No se puede cambiar con la pila abierta — ciérrala primero."
                      :"Cuál instrumento opera el Experimento (afecta precio en vivo y, si aplica, el contrato real en Deriv)."}</div></div>
                <select value={expSymbol} disabled={expPositions.length>0||!!expHedgePos}
                  onChange={e=>{
                    if(expPositions.length>0||expHedgePos){ addLog("No se puede cambiar de símbolo con la pila abierta — ciérrala primero.","info"); return; }
                    setExpSymbol(e.target.value);
                  }}
                  style={{background:T.dim,color:T.text,border:`1px solid ${T.border}`,borderRadius:5,padding:"6px 10px",fontSize:11,fontWeight:600}}>
                  {Object.keys(EXP_SYMBOLS).map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:11,borderBottom:`1px solid ${T.border}`,marginBottom:11}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Activar experimento</div>
                  <div style={{fontSize:8,color:T.muted}}>Corre en segundo plano con su propio feed de {expSymbol}</div></div>
                <ConfigToggle on={expEnabled} onClick={()=>setExpEnabled(p=>!p)}/>
              </div>

              {/* Modo en vivo: la MISMA lógica de piso/pirámide/canario/cobertura
                  decide cuándo abrir/cerrar, pero en vez de simularlo llama de
                  verdad a Deriv (Multiplicadores, Gold/USD) — pedido explícito
                  tras confirmar que esa API sí opera oro aunque el feed público
                  de precios lo rechace. SOLO el motor del servidor ejecuta
                  (ver nota en claimOrCheckOwnership); esta pestaña nunca abre
                  ni cierra contratos reales por su cuenta. */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:11,
                borderBottom:`1px solid ${T.border}`,marginBottom:11,background:expDerivLive?`${T.red}0e`:"transparent",
                border:expDerivLive?`1px solid ${T.red}40`:"none",borderRadius:expDerivLive?8:0,padding:expDerivLive?"8px 10px":0}}>
                <div><div style={{fontSize:12,fontWeight:600,color:expDerivLive?T.red:T.text}}>
                  {expDerivLive?"🔴 EN VIVO — Deriv demo (dinero demo real)":"Operar en vivo (Deriv demo)"}</div>
                  <div style={{fontSize:8,color:T.muted}}>
                    {expDerivLive?`Cada apertura/cierre es un contrato REAL en tu cuenta demo de Deriv (${expSymbol}).`
                      :"Apagado: solo simula. Al activar, abre/cierra contratos reales de Multiplicadores en tu cuenta DEMO de Deriv."}</div></div>
                <ConfigToggle on={expDerivLive} onClick={()=>{
                  if(!expDerivLive && !window.confirm(`Esto hace que el Experimento abra y cierre contratos REALES (Multiplicadores, ${expSymbol}) en tu cuenta DEMO de Deriv, usando saldo demo real. ¿Continuar?`)) return;
                  setExpDerivLive(p=>!p);
                }}/>
              </div>

              {/* Presets — pedido explícito: "me gustaría poderla guardar
                  para ir guardando mis configuraciones" + "si yo lo quiero
                  dejar nuevamente con estos parámetros, pues solamente es
                  configurarle la cantidad" — en vez de reescribir los 4
                  números a mano cada vez, guardarlos con un nombre y
                  cargarlos con un clic. Persistido en bot_config
                  (exp_presets), igual que todo lo demás — se ve igual
                  desde cualquier dispositivo. */}
              <div style={{marginBottom:10,padding:"8px 10px",background:T.dim,borderRadius:6}}>
                <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:6}}>CONFIGURACIONES GUARDADAS</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:expPresets.length?8:0}}>
                  <input type="text" placeholder="Nombre (ej. BTC agresivo chico)" value={expPresetNameInput}
                    onChange={e=>setExpPresetNameInput(e.target.value)}
                    style={{background:T.panel,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,padding:"6px 8px",fontSize:10,flex:"1 1 200px"}}/>
                  <button onClick={()=>{
                    const name=expPresetNameInput.trim();
                    if(!name) return;
                    const preset={name,symbol:expSymbol,stake:expStake,addStep:expAddStep,floorStart:expFloorStart,maxStack:expMaxStack};
                    const next=[...expPresets.filter(p=>p.name!==name),preset];
                    setExpPresets(next); setExpPresetNameInput("");
                    fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({key:"exp_presets",value:JSON.stringify(next)})}).catch(()=>{});
                    addLog(`💾 Configuración "${name}" guardada (${expSymbol}, stake ${fUSD(expStake,false)}, apilar ${fUSD(expAddStep,false)}, piso ${fUSD(expFloorStart)})`,"info");
                  }} disabled={!expPresetNameInput.trim()}
                    style={{background:expPresetNameInput.trim()?T.accent:T.border,color:"#fff",border:"none",borderRadius:4,
                      padding:"6px 12px",cursor:expPresetNameInput.trim()?"pointer":"default",fontSize:10,fontWeight:700}}>
                    💾 Guardar actual
                  </button>
                </div>
                {expPresets.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {expPresets.map(p=>(
                      <div key={p.name} style={{display:"flex",alignItems:"center",gap:4,background:T.panel,border:`1px solid ${T.border}`,borderRadius:5,padding:"4px 4px 4px 9px"}}>
                        <span style={{fontSize:9,fontWeight:600,color:T.text}}
                          title={`${p.symbol} · stake ${fUSD(p.stake,false)} · apilar ${fUSD(p.addStep,false)} · piso ${fUSD(p.floorStart)} · máx ${p.maxStack}`}>
                          {p.name}
                        </span>
                        <button onClick={()=>{
                          if((expPositions.length>0||expHedgePos) && p.symbol!==expSymbol){
                            addLog(`⚠️ "${p.name}" es de ${p.symbol} pero hay una pila abierta en ${expSymbol} — se aplican los demás valores, el símbolo NO cambia hasta que cierres la pila.`,"info");
                          } else if(!(expPositions.length>0||expHedgePos)){
                            setExpSymbol(p.symbol);
                          }
                          setExpStake(p.stake); setExpStakeText(String(p.stake));
                          setExpAddStep(p.addStep); setExpAddStepText(String(p.addStep));
                          setExpFloorStart(p.floorStart); setExpFloorStartText(String(p.floorStart));
                          setExpMaxStack(p.maxStack); setExpMaxStackText(String(p.maxStack));
                          addLog(`📂 Configuración "${p.name}" cargada`,"info");
                        }} title="Cargar esta configuración"
                          style={{background:"transparent",border:"none",color:T.green,cursor:"pointer",fontSize:11,padding:"2px 4px"}}>
                          ▶
                        </button>
                        <button onClick={()=>{
                          if(!window.confirm(`¿Borrar la configuración "${p.name}"?`)) return;
                          const next=expPresets.filter(x=>x.name!==p.name);
                          setExpPresets(next);
                          fetch("/api/exp-state",{method:"POST",headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({key:"exp_presets",value:JSON.stringify(next)})}).catch(()=>{});
                        }} title="Borrar"
                          style={{background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:11,padding:"2px 4px"}}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}} className="g4">
                <ConfigField label="STAKE POR POSICIÓN (USD, min. real Deriv $2)" type="text" inputMode="decimal" value={expStakeText}
                  onChange={e=>{const v=e.target.value; setExpStakeText(v); const n=parseFloat(v); if(!isNaN(n)) setExpStake(n);}}
                  onBlur={()=>{const n=Math.max(0.1,parseFloat(expStakeText)||1); setExpStake(n); setExpStakeText(String(n));}}/>
                <ConfigField label="APILAR CADA (USD)" type="text" inputMode="decimal" value={expAddStepText}
                  onChange={e=>{const v=e.target.value; setExpAddStepText(v); const n=parseFloat(v); if(!isNaN(n)) setExpAddStep(n);}}
                  onBlur={()=>{const n=Math.max(0.01,parseFloat(expAddStepText)||50); setExpAddStep(n); setExpAddStepText(String(n));}}/>
                <ConfigField label="PISO INICIAL (USD, negativo)" type="text" inputMode="decimal" value={expFloorStartText}
                  onChange={e=>{const v=e.target.value; setExpFloorStartText(v); const n=parseFloat(v); if(!isNaN(n)) setExpFloorStart(n);}}
                  onBlur={()=>{const n=Math.min(-0.01,parseFloat(expFloorStartText)||-50); setExpFloorStart(n); setExpFloorStartText(String(n));}}/>
                <ConfigField label="MÁXIMO DE POSICIONES" type="text" inputMode="numeric" value={expMaxStackText}
                  onChange={e=>{const v=e.target.value; setExpMaxStackText(v); const n=parseInt(v,10); if(!isNaN(n)) setExpMaxStack(n);}}
                  onBlur={()=>{const n=Math.max(1,Math.min(10,parseInt(expMaxStackText,10)||10)); setExpMaxStack(n); setExpMaxStackText(String(n));}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:14}} className="g4">
                <div style={{background:T.dim,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>DIRECCIÓN ACTUAL</div>
                  <div className="mono" style={{fontSize:12,fontWeight:700,color:expDirection==="BUY"?T.green:expDirection==="SELL"?T.red:T.muted}}>
                    {expDirection||"—"}
                  </div>
                </div>
                <div style={{background:T.dim,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>PILA / PISO</div>
                  <div className="mono" style={{fontSize:12,fontWeight:700}}>{expPositions.length}/{expMaxStack} · {fUSD(expFloorRef.current)}</div>
                </div>
                <div style={{background:T.dim,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>VOLUMEN (NOTIONAL)</div>
                  <div className="mono" style={{fontSize:12,fontWeight:700}}>${volumen.toFixed(0)}</div>
                </div>
                <div style={{background:T.dim,borderRadius:5,padding:"7px 9px"}}
                  title={`lotes = volumen notional / (${EXP_SYMBOLS[expSymbol]?.lotUnit} ${expSymbol==="XAU/USD"?"oz":"unidad"}/lote × precio) — la misma unidad que MT5/MT4`}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>VOLUMEN MT5 (LOTES)</div>
                  <div className="mono" style={{fontSize:12,fontWeight:700}}>{expPrice?(volumen/((EXP_SYMBOLS[expSymbol]?.lotUnit||100)*expPrice)).toFixed(3):"—"}</div>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}} className="g4">
                {[
                  {l:"P&L PILA ABIERTA", v:fUSD(stackPnl), c:stackPnl>=0?T.green:T.red},
                  {l:`TRADES CERRADOS${expHasFilters?" (filtro)":""}`, v:expHourlyStats===null?"…":expSummary.trades, c:T.text},
                  {l:"WIN RATE", v:expWr==null?"—":`${expWr}%`, c:expWr>=50?T.green:T.red},
                  {l:`P&L ACUMULADO${expHasFilters?" (filtro)":""}`, v:fUSD(expTotalPnl), c:expTotalPnl>=0?T.green:T.red},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:T.dim,borderRadius:5,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>{l}</div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* POSICIONES ABIERTAS — mismas columnas que la tabla de Histórico
                  del bot principal (TIPO/ENTRADA/ACTUAL/%/OBJETIVO/STOP/PNL/
                  VOL-COMISIÓN/ORIGEN/ESTADO), pedido explícitamente. OBJETIVO
                  y STOP son valores de LA PILA (no por posición individual —
                  esta estrategia no tiene TP/SL propio por posición, ver el
                  comentario de las constantes EXP_* arriba), por eso se
                  repiten iguales en cada fila mientras la pila esté abierta. */}
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.accent,letterSpacing:1}}>POSICIONES ABIERTAS EN VIVO</div>
                  {(expPositions.length>0||expHedgePos)&&(
                    <button onClick={()=>{if(window.confirm("¿Cerrar TODA la pila (y la cobertura si hay) ahora mismo?")) requestExpManualClose("all");}}
                      style={{background:`${T.red}18`,border:`1px solid ${T.red}50`,color:T.red,borderRadius:5,
                        padding:"4px 10px",cursor:"pointer",fontSize:9,fontWeight:700}}>
                      ✕ Cerrar todo
                    </button>
                  )}
                </div>
                {expPositions.length>0&&(
                  <div style={{fontSize:8,color:T.muted,marginBottom:8}}>
                    OBJETIVO/STOP son de <b>la pila completa</b>, no por posición — todas cierran juntas al mismo
                    tiempo al mismo precio cuando se apila/voltea, por eso se repiten en cada fila. Lo que sí es
                    propio de cada una es PNL (según su propia entrada).
                  </div>
                )}
                {expPositions.length===0?(
                  <div style={{background:T.dim,borderRadius:8,padding:"16px",textAlign:"center",fontSize:10,color:T.muted}}>
                    Sin posiciones abiertas ahora mismo.
                  </div>
                ):(
                  <div className="table-scroll">
                    <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:1140}}>
                      <div style={{display:"grid",gridTemplateColumns:"70px 90px 90px 70px 100px 100px 100px 100px 100px 110px 100px 80px",
                        gap:10,padding:"0 10px 4px",fontSize:7,color:T.muted,letterSpacing:1,fontWeight:700}}>
                        <div>TIPO</div><div>ENTRADA</div><div>ACTUAL</div><div>%</div><div>OBJETIVO PILA</div><div>STOP PILA</div><div>PNL</div><div>VOL/COMISIÓN</div><div>ORIGEN</div><div>ESTADO</div><div>PATRONES</div><div>ACCIÓN</div>
                      </div>
                      {expPositions.map(pos=>{
                        // El precio EN VIVO manda (se actualiza cada 1s, ya
                        // viene de Deriv) — derivSpot es solo el ancla real
                        // que usa effExpPnL para corregir el PNL, no para
                        // "congelar" lo que se ve en pantalla.
                        const livePrice=expPrice??pos.derivSpot??pos.entry;
                        const dir=pos.type==="BUY"?1:-1;
                        const pnl=effExpPnL(pos,livePrice);
                        const pctChange=dir*(livePrice-pos.entry)/pos.entry*100;
                        const col=pnl>=0?T.green:T.red;
                        const dirCol=pos.type==="BUY"?T.green:T.red;
                        const isProtected=expFloorRef.current>0;
                        const volumen=pos.allocatedSize*(pos.multiplier||DEFAULT_MULTIPLIER);
                        const elapsedMin=Math.floor((Date.now()-(pos.openTime||Date.now()))/60000);
                        return(
                          <div key={pos.id} style={{display:"grid",gridTemplateColumns:"70px 90px 90px 70px 100px 100px 100px 100px 100px 110px 100px 80px",
                            gap:10,alignItems:"center",background:`${col}08`,border:`1px solid ${col}35`,borderRadius:7,padding:"8px 10px"}}>
                            <span style={{fontSize:10,fontWeight:700,color:dirCol}}>{pos.type==="BUY"?"▲ BUY":"▼ SELL"}{pos.contractId&&<span title="Contrato real en Deriv" style={{marginLeft:4,fontSize:8,color:T.red}}>🔴</span>}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(pos.entry,2)}</span>
                            <span className="mono" style={{fontSize:10,color:T.text}}>{fP(livePrice,2)}</span>
                            <span className="mono" style={{fontSize:10,fontWeight:700,color:col}}>{fPct(pctChange)}</span>
                            <span className="mono" style={{fontSize:10,color:T.green}}>{fUSD(expAddLevelRef.current+expAddStepRef.current,false)}</span>
                            <span className="mono" style={{fontSize:10,color:isProtected?T.green:T.red}}>{fUSD(expFloorRef.current)}</span>
                            <span className="mono" style={{fontSize:11,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
                            <div>
                              <div className="mono" style={{fontSize:10,fontWeight:700,color:T.text}}>${volumen.toFixed(0)}</div>
                              <div style={{fontSize:7,color:T.muted}}>sin comisión</div>
                            </div>
                            <span style={{fontSize:8,fontWeight:700,color:T.bg,background:T.yellow,padding:"2px 7px",borderRadius:4,width:"fit-content"}}>EXPERIMENTO</span>
                            <span style={{fontSize:9,fontWeight:700,color:isProtected?T.green:T.muted,
                              background:isProtected?`${T.green}18`:"transparent",padding:isProtected?"3px 7px":0,borderRadius:4}}>
                              {isProtected?"🔒 protegida":`hace ${elapsedMin}m`}
                            </span>
                            <span style={{fontSize:8,fontWeight:700,color:T.text,background:T.dim,padding:"2px 7px",borderRadius:4,width:"fit-content"}}>{pos.pattern||"—"}</span>
                            <button onClick={()=>{if(window.confirm(`¿Cerrar esta posición ${pos.type}${pos.contractId?" (contrato real en Deriv)":""}?`)) requestExpManualClose("one",pos.id);}}
                              title={pos.contractId?"Cerrar este contrato en Deriv":"Cerrar esta posición simulada"}
                              style={{background:"transparent",border:`1px solid ${T.red}50`,
                                color:T.red,borderRadius:5,padding:"4px 8px",cursor:"pointer",fontSize:8,fontWeight:700}}>
                              ✕ Cerrar
                            </button>
                          </div>
                        );
                      })}
                      {/* Fila de total — el STOP/OBJETIVO PILA se compara contra la
                          SUMA de todas las filas, no contra una sola; esto evita
                          tener que sumarlas a mano para saber si ya está cerca del
                          piso o no (pedido explícito tras verlo confuso en vivo). */}
                      <div style={{display:"grid",gridTemplateColumns:"70px 90px 90px 70px 100px 100px 100px 100px 100px 110px 100px 80px",
                        gap:10,alignItems:"center",background:T.dim,border:`2px solid ${stackPnl>=0?T.green:T.red}`,borderRadius:7,padding:"8px 10px"}}>
                        <span style={{fontSize:9,fontWeight:700,color:T.muted,gridColumn:"1 / 7"}}>TOTAL PILA ({expPositions.length}/{expMaxStack})</span>
                        <span className="mono" style={{fontSize:12,fontWeight:700,color:stackPnl>=0?T.green:T.red}}>{fUSD(stackPnl)}</span>
                        <span></span><span></span><span></span><span></span>
                      </div>
                      {expHedgePos&&(()=>{
                        const hLive=expPrice??expHedgePos.derivSpot??expHedgePos.entry;
                        const hDir=expHedgePos.type==="BUY"?1:-1;
                        const hPnl=effExpPnL(expHedgePos,hLive);
                        const hPct=hDir*(hLive-expHedgePos.entry)/expHedgePos.entry*100;
                        const hCol=hPnl>=0?T.green:T.red;
                        return(
                          <div style={{display:"grid",gridTemplateColumns:"70px 90px 90px 70px 100px 100px 100px 100px 100px 110px 100px 80px",
                            gap:10,alignItems:"center",background:`${hCol}10`,border:`2px dashed ${hCol}`,borderRadius:7,padding:"8px 10px"}}>
                            <span style={{fontSize:10,fontWeight:700,color:expHedgePos.type==="BUY"?T.green:T.red}}>{expHedgePos.type==="BUY"?"▲ BUY":"▼ SELL"}{expHedgePos.contractId&&<span title="Contrato real en Deriv" style={{marginLeft:4,fontSize:8,color:T.red}}>🔴</span>}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>{fP(expHedgePos.entry,2)}</span>
                            <span className="mono" style={{fontSize:10,color:T.text}}>{fP(hLive,2)}</span>
                            <span className="mono" style={{fontSize:10,fontWeight:700,color:hCol}}>{fPct(hPct)}</span>
                            <span></span><span></span>
                            <span className="mono" style={{fontSize:11,fontWeight:700,color:hCol}}>{fUSD(hPnl)}</span>
                            <div><div className="mono" style={{fontSize:10,fontWeight:700,color:T.text}}>${(expHedgePos.allocatedSize*(expHedgePos.multiplier||DEFAULT_MULTIPLIER)).toFixed(0)}</div></div>
                            <span style={{fontSize:8,fontWeight:700,color:T.bg,background:T.accent,padding:"2px 7px",borderRadius:4,width:"fit-content"}}>🛡️ COBERTURA</span>
                            <span style={{fontSize:8,color:T.muted}}>cierra con la pila</span>
                            <span style={{fontSize:8,fontWeight:700,color:T.text,background:T.dim,padding:"2px 7px",borderRadius:4,width:"fit-content"}}>{expHedgePos.pattern||"COBERTURA"}</span>
                            <button onClick={()=>{if(window.confirm(`¿Cerrar la cobertura ${expHedgePos.type}${expHedgePos.contractId?" (contrato real en Deriv)":""}?`)) requestExpManualClose("one",expHedgePos.id);}}
                              title={expHedgePos.contractId?"Cerrar este contrato en Deriv":"Cerrar esta cobertura simulada"}
                              style={{background:"transparent",border:`1px solid ${T.red}50`,
                                color:T.red,borderRadius:5,padding:"4px 8px",cursor:"pointer",fontSize:8,fontWeight:700}}>
                              ✕ Cerrar
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* HISTÓRICO — mismas columnas que la tabla de Histórico del bot
                  principal (APERTURA/CIERRE/PAR/TIPO/ENTRADA/SALIDA/%/
                  OBJETIVO PILA/STOP PILA/PNL/MOTIVO/VOL-COMISIÓN/ORIGEN/
                  PATRONES), pedido explícitamente. %/OBJETIVO PILA/STOP
                  PILA son los mismos datos que ya muestra la tabla de
                  POSICIONES ABIERTAS EN VIVO, pero congelados al momento
                  del cierre (para ver qué tanto se movió el oro y contra
                  qué objetivo/piso cerró esa posición). PATRONES aquí es
                  el motivo de APERTURA de la posición (VELA ANTERIOR/
                  PIRÁMIDE/VOLTEO/COBERTURA) — distinto de MOTIVO, que es
                  el motivo de CIERRE (FLIP/HEDGE). */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:T.accent,letterSpacing:1}}>HISTÓRICO</div>
                <div style={{fontSize:8,color:T.muted}}>Usa el filtro de arriba (fechas/PAR/tipo/resultado) · {expHistTotal} trade{expHistTotal!==1?"s":""}</div>
              </div>
              {expHistTotal===0&&(
                <div style={{background:T.dim,borderRadius:8,padding:"16px",textAlign:"center",fontSize:10,color:T.muted}}>
                  {expHasFilters?"Ningún trade coincide con el filtro.":"Sin historial todavía."}
                </div>
              )}
              {expHistTotal>0&&(
                <div className="table-scroll">
                  <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:1220}}>
                    <div style={{display:"grid",gridTemplateColumns:"95px 95px 80px 70px 90px 90px 70px 100px 100px 90px 90px 100px 100px 1fr",
                      gap:8,padding:"0 10px 4px",fontSize:7,color:T.muted,letterSpacing:1,fontWeight:700}}>
                      <div>APERTURA</div><div>CIERRE</div><div>PAR</div><div>TIPO</div><div>ENTRADA</div><div>SALIDA</div>
                      <div>%</div><div>OBJETIVO PILA</div><div>STOP PILA</div>
                      <div>PNL</div><div>MOTIVO</div><div>VOL/COMISIÓN</div><div>ORIGEN</div><div>PATRONES</div>
                    </div>
                    {(()=>{
                      // Agrupa filas consecutivas del MISMO cierre (misma salida +
                      // mismo motivo + dentro de la misma ventana de 2s) — una
                      // pila de 10 posiciones cierra TODAS juntas en un solo
                      // volteo, y sin esto se veían como 10 filas sueltas sin
                      // forma de ver de un vistazo cuánto dio ESE cierre en total
                      // (pedido explícito: "genera confusión").
                      const groups=[];
                      for(const t of expHistRows){
                        const key=`${t.closeTime?Math.floor(t.closeTime/2000):"x"}_${t.exit}_${t.reason}`;
                        const last=groups[groups.length-1];
                        if(last&&last.key===key) last.items.push(t);
                        else groups.push({key,items:[t]});
                      }
                      return groups.map((g,gi)=>{
                        const groupTotal=g.items.reduce((s,t)=>s+t.pnl,0);
                        return(
                          <div key={gi} style={{display:"flex",flexDirection:"column",gap:4,marginBottom:g.items.length>1?8:4}}>
                            {g.items.map((t,i)=>{
                              const volumen=(t.allocatedSize||0)*(t.multiplier||0);
                              const tDir=t.type==="BUY"?1:-1;
                              const tPct=t.entry?tDir*(t.exit-t.entry)/t.entry*100:0;
                              return(
                                <div key={i} style={{display:"grid",gridTemplateColumns:"95px 95px 80px 70px 90px 90px 70px 100px 100px 90px 90px 100px 100px 1fr",
                                  gap:8,alignItems:"center",background:`${t.pnl>=0?T.green:T.red}08`,border:`1px solid ${t.pnl>=0?T.green:T.red}25`,borderRadius:6,padding:"6px 10px"}}>
                                  <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.openTime)}</span>
                                  <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.closeTime)}</span>
                                  <span style={{fontSize:10,fontWeight:700,color:T.text}}>{t.symbol||expSymbol}</span>
                                  <span style={{fontSize:9,fontWeight:700,color:t.type==="BUY"?T.green:T.red}}>{t.type}</span>
                                  <span className="mono" style={{fontSize:9}}>{fP(t.entry,2)}</span>
                                  <span className="mono" style={{fontSize:9}}>{fP(t.exit,2)}</span>
                                  <span className="mono" style={{fontSize:9,fontWeight:700,color:tPct>=0?T.green:T.red}}>{fPct(tPct)}</span>
                                  <span className="mono" style={{fontSize:9,color:T.green}}>{t.objetivoPila!=null?fUSD(t.objetivoPila,false):"—"}</span>
                                  <span className="mono" style={{fontSize:9,color:t.stopPila>=0?T.green:T.red}}>{t.stopPila!=null?fUSD(t.stopPila):"—"}</span>
                                  <span className="mono" style={{fontSize:10,fontWeight:700,color:t.pnl>=0?T.green:T.red}}>{fUSD(t.pnl)}</span>
                                  <span style={{fontSize:8,fontWeight:700,color:t.pnl>=0?T.green:T.red,background:`${t.pnl>=0?T.green:T.red}18`,padding:"2px 7px",borderRadius:4,textAlign:"center"}}>{t.reason||"—"}</span>
                                  <div>
                                    <div className="mono" style={{fontSize:9,fontWeight:700,color:T.text}}>{volumen?`$${volumen.toFixed(0)}`:"—"}</div>
                                    <div style={{fontSize:7,color:T.muted}}>sin comisión</div>
                                  </div>
                                  <span style={{fontSize:8,fontWeight:700,color:T.bg,background:T.yellow,padding:"2px 7px",borderRadius:4,textAlign:"center",width:"fit-content"}}>EXPERIMENTO</span>
                                  <span style={{fontSize:9,color:T.muted}}>{t.pattern||"—"}</span>
                                </div>
                              );
                            })}
                            {g.items.length>1&&(
                              <div style={{display:"grid",gridTemplateColumns:"95px 95px 80px 70px 90px 90px 70px 100px 100px 90px 90px 100px 100px 1fr",
                                gap:8,alignItems:"center",background:T.dim,border:`2px solid ${groupTotal>=0?T.green:T.red}`,borderRadius:6,padding:"5px 10px"}}>
                                <span style={{fontSize:8,fontWeight:700,color:T.muted,gridColumn:"1 / 10"}}>TOTAL de este cierre ({g.items.length} posiciones)</span>
                                <span className="mono" style={{fontSize:10,fontWeight:700,color:groupTotal>=0?T.green:T.red}}>{fUSD(groupTotal)}</span>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
              {expHistTotalPages>1&&(
                <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:10}}>
                  <button disabled={expHistPageSafe<=1} onClick={()=>setExpHistPage(p=>Math.max(1,p-1))}
                    style={{background:"transparent",border:`1px solid ${T.border}`,color:expHistPageSafe<=1?T.muted:T.text,
                      borderRadius:5,padding:"5px 12px",cursor:expHistPageSafe<=1?"default":"pointer",fontSize:10,fontWeight:600,opacity:expHistPageSafe<=1?0.5:1}}>
                    ← Anterior
                  </button>
                  <span style={{fontSize:9,color:T.muted}}>Página {expHistPageSafe} de {expHistTotalPages} · {expHistTotal} trades</span>
                  <button disabled={expHistPageSafe>=expHistTotalPages} onClick={()=>setExpHistPage(p=>Math.min(expHistTotalPages,p+1))}
                    style={{background:"transparent",border:`1px solid ${T.border}`,color:expHistPageSafe>=expHistTotalPages?T.muted:T.text,
                      borderRadius:5,padding:"5px 12px",cursor:expHistPageSafe>=expHistTotalPages?"default":"pointer",fontSize:10,fontWeight:600,opacity:expHistPageSafe>=expHistTotalPages?0.5:1}}>
                    Siguiente →
                  </button>
                </div>
              )}

              {expTrades.length>0&&(
                <button onClick={()=>{if(window.confirm("¿Borrar historial del experimento?")){setExpTrades([]);saveExpTrades([]);}}}
                  style={{marginTop:10,background:"transparent",border:`1px solid ${T.border}`,color:T.muted,
                    borderRadius:5,padding:"5px 10px",cursor:"pointer",fontSize:9}}>
                  🗑 Borrar historial del experimento
                </button>
              )}

              {/* HISTÓRICO REAL DE DERIV — pedido explícito: "¿puedo ver el
                  histórico de Deriv aquí?" para comparar contra lo nuestro.
                  Se carga a mano (botón), NUNCA solo — hoy completo se fue
                  en encontrar y arreglar choques contra el límite de
                  velocidad de Deriv por llamadas automáticas de más. */}
              <div style={{marginTop:24,paddingTop:16,borderTop:`1px solid ${T.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.accent,letterSpacing:1}}>HISTÓRICO REAL DE DERIV</div>
                  <button onClick={loadExpDerivHistory} disabled={expDerivHistoryLoading}
                    style={{background:T.accent,color:"#fff",border:"none",borderRadius:4,padding:"5px 12px",
                      cursor:expDerivHistoryLoading?"default":"pointer",fontSize:10,fontWeight:700,opacity:expDerivHistoryLoading?0.6:1}}>
                    {expDerivHistoryLoading?"Cargando…":"🔄 Actualizar"}
                  </button>
                </div>
                <div style={{fontSize:8,color:T.muted,marginBottom:8}}>
                  Últimos contratos liquidados en TU cuenta de Deriv (profit_table real) — incluye cualquier
                  operación, del Experimento o manual en DTrader. No trae símbolo/dirección por fila (evita
                  consultas extra a Deriv) — compara por precio/hora contra el histórico de arriba.
                </div>
                {expDerivHistory===null&&!expDerivHistoryLoading&&(
                  <div style={{background:T.dim,borderRadius:8,padding:"14px",textAlign:"center",fontSize:10,color:T.muted}}>
                    Dale "Actualizar" para traer el historial real de Deriv.
                  </div>
                )}
                {expDerivHistory?.error&&(
                  <div style={{background:`${T.red}10`,border:`1px solid ${T.red}40`,borderRadius:8,padding:"14px",textAlign:"center",fontSize:10,color:T.red}}>
                    {expDerivHistory.error}
                  </div>
                )}
                {Array.isArray(expDerivHistory)&&expDerivHistory.length===0&&(
                  <div style={{background:T.dim,borderRadius:8,padding:"14px",textAlign:"center",fontSize:10,color:T.muted}}>
                    Sin contratos liquidados todavía.
                  </div>
                )}
                {Array.isArray(expDerivHistory)&&expDerivHistory.length>0&&(
                  <div className="table-scroll">
                    <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:760}}>
                      <div style={{display:"grid",gridTemplateColumns:"110px 130px 130px 100px 100px 100px",
                        gap:8,padding:"0 10px 4px",fontSize:7,color:T.muted,letterSpacing:1,fontWeight:700}}>
                        <div>CONTRATO</div><div>APERTURA</div><div>CIERRE</div><div>STAKE</div><div>VALOR FINAL</div><div>PNL</div>
                      </div>
                      {expDerivHistory.map(t=>(
                        <div key={t.contractId} style={{display:"grid",gridTemplateColumns:"110px 130px 130px 100px 100px 100px",
                          gap:8,alignItems:"center",background:`${t.profit>=0?T.green:T.red}08`,border:`1px solid ${t.profit>=0?T.green:T.red}25`,borderRadius:6,padding:"6px 10px"}}>
                          <span className="mono" style={{fontSize:9,color:T.muted}}>{t.contractId}</span>
                          <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.openTime)}</span>
                          <span className="mono" style={{fontSize:9,color:T.muted}}>{fDateTime(t.closeTime)}</span>
                          <span className="mono" style={{fontSize:10}}>{fUSD(t.buyPrice,false)}</span>
                          <span className="mono" style={{fontSize:10}}>{fUSD(t.sellPrice,false)}</span>
                          <span className="mono" style={{fontSize:10,fontWeight:700,color:t.profit>=0?T.green:T.red}}>{fUSD(t.profit)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ConfigCard>

          </div>
          );
        })()}

      </div>
      </div>
    </>
  );
}
