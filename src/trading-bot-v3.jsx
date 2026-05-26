import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, LineStyle, CrosshairMode } from "lightweight-charts";

/* ─── THEME ─────────────────────────────────────────────────────────────── */
const T = {
  bg:"#04060f", panel:"#080d1c", card:"#0c1220", border:"#152035",
  accent:"#00b8e6", green:"#00e676", red:"#ff1744", yellow:"#ffd600",
  orange:"#ff6d00", text:"#c8d8f0", muted:"#344d70", dim:"#0f1828",
};

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Barlow:wght@300;400;600;700;900&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:${T.bg};color:${T.text};font-family:'Barlow',sans-serif;overflow-x:hidden;}
  ::-webkit-scrollbar{width:3px;height:3px;}
  ::-webkit-scrollbar-track{background:${T.bg};}
  ::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  button{font-family:'Barlow',sans-serif;transition:all .15s ease;}
  button:hover{filter:brightness(1.15);}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
  @keyframes breathe{0%,100%{box-shadow:0 0 0 0 #00e67630}50%{box-shadow:0 0 0 6px #00e67600}}
  @keyframes scanPulse{0%,100%{opacity:.03}50%{opacity:.07}}
  .live::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:${T.green};animation:pulse 1.4s ease-in-out infinite;margin-right:6px;}
  .fade-up{animation:fadeUp .3s ease forwards;}
  .breathe{animation:breathe 2s ease-in-out infinite;}
  .scanlines{position:fixed;inset:0;pointer-events:none;z-index:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,184,230,.008) 2px,rgba(0,184,230,.008) 4px);animation:scanPulse 5s ease-in-out infinite;}
`;

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
};

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
// TP/SL expressed as % of notional so they scale with positionSize
// 0.3% TP and 0.2% SL → at $1000 notional = $3/$2, at $1 notional = $0.003/$0.002
const TAKE_PROFIT_PCT    = 0.003;  // 0.3%
const STOP_LOSS_PCT      = 0.002;  // 0.2%
const MAX_POSITIONS      = 3; // per symbol — correlated pairs open in parallel
const POSITION_USD       = 1000;
const ANALYSIS_INTERVAL_MS = 90000; // 90s — balanced for 5M charts and Groq free tier (~133 analyses/day)
// Helpers to get dollar amounts from positionSize
const tpUSD = (ps=POSITION_USD) => ps * TAKE_PROFIT_PCT;
const slUSD = (ps=POSITION_USD) => ps * STOP_LOSS_PCT;

/* ─── UTILS ─────────────────────────────────────────────────────────────── */
const fP   = (n, p) => Number(n).toFixed(p);
const fUSD = (n, sign=true) => {
  const abs=Math.abs(n);
  const dec=abs<0.01?4:abs<0.10?3:2;
  return (sign&&n>=0?"+":"")+`$${abs.toFixed(dec)}`;
};
const fPct = n => (n>=0?"+":"")+n.toFixed(3)+"%";
const now  = () => new Date().toLocaleTimeString("es");

function posPnL(pos, price, posSize=POSITION_USD){
  const dir = pos.type==="BUY" ? 1 : -1;
  return dir * (price - pos.entry) / pos.entry * posSize;
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
  const e12=calcEMA(closes.slice(-26),12),e26=calcEMA(closes.slice(-26),26);
  const macd=e12-e26,signal=macd*.82;
  return{macd,signal,hist:macd-signal};
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
  const recent=candles.slice(-200);
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
function saveBalance(b){ try{localStorage.setItem(LS_BALANCE,String(b));}catch{} }
function loadBalance(){ try{const v=localStorage.getItem(LS_BALANCE);return v?parseFloat(v):10000;}catch{return 10000;} }

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
  const recent=candles.slice(-60);
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

/* ─── LIGHTWEIGHT CHART ─────────────────────────────────────────────────── */
function LWChart({ candles, positions, trades, symbol, precision, srLevels, positionSize=POSITION_USD }){
  const mainRef  = useRef(null);
  const rsiRef   = useRef(null);
  const macdRef  = useRef(null);
  const charts      = useRef({});
  const series      = useRef({});
  const posLines    = useRef([]);
  const srLines     = useRef([]);
  const firstLoad   = useRef(true);
  const prevFitPrice= useRef(null);
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
    const macdHist=macdChart.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false, title:"Hist" });
    const macdLine=macdChart.addLineSeries({ color:"#00b8e6", lineWidth:1.5, title:"MACD", priceLineVisible:false, lastValueVisible:true });
    const macdSig =macdChart.addLineSeries({ color:"#ff6d00", lineWidth:1.5, title:"Signal", priceLineVisible:false, lastValueVisible:true });
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

    // Candles & volume
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

    // MACD per candle
    const mhD=[],mlD=[],msD=[];
    for(let i=26;i<closes.length;i++){
      const sl=closes.slice(i-25,i+1);
      let e12=sl[0],e26=sl[0];
      const k12=2/13,k26=2/27;
      for(let j=1;j<sl.length;j++){e12=sl[j]*k12+e12*(1-k12);e26=sl[j]*k26+e26*(1-k26);}
      const mv=e12-e26, sv=mv*0.82, hv=mv-sv;
      mlD.push({time:times[i],value:mv});
      msD.push({time:times[i],value:sv});
      mhD.push({time:times[i],value:hv,color:hv>=0?"#00e67680":"#ff174480"});
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

  /* ── position lines (entry, TP, SL) ── */
  useEffect(()=>{
    const {cs}=series.current;
    if(!cs) return;
    posLines.current.forEach(l=>{try{cs.removePriceLine(l);}catch{}});
    posLines.current=[];

    positions.forEach(pos=>{
      const isBuy=pos.type==="BUY";
      const entryCol=isBuy?"#00e676":"#ff1744";
      const tp=isBuy
        ? pos.entry*(1+TAKE_PROFIT_PCT)
        : pos.entry*(1-TAKE_PROFIT_PCT);
      const sl=isBuy
        ? pos.entry*(1-STOP_LOSS_PCT)
        : pos.entry*(1+STOP_LOSS_PCT);

      posLines.current.push(
        cs.createPriceLine({price:pos.entry, color:entryCol,  lineWidth:2, lineStyle:LineStyle.Solid,  axisLabelVisible:true,  title:`${pos.type}`}),
        cs.createPriceLine({price:tp,        color:"#00e676", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:`TP +${(TAKE_PROFIT_PCT*100).toFixed(2)}%`}),
        cs.createPriceLine({price:sl,        color:"#ff1744", lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:false, title:`SL -${(STOP_LOSS_PCT*100).toFixed(2)}%`}),
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
function PosRow({pos, price, precision, onClose, positionSize=POSITION_USD}){
  const pnl=posPnL(pos,price,positionSize);
  const col=pnl>=0?T.green:T.red;
  const pct=Math.min(100,Math.max(0,(pnl/tpUSD(positionSize))*100));
  const pctChange=(price-pos.entry)/pos.entry*100;
  const isBuy=pos.type==="BUY";
  return(
    <div className="fade-up" style={{background:T.card,border:`1px solid ${col}30`,borderRadius:6,padding:"8px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,fontWeight:700,color:col,background:`${col}18`,padding:"2px 8px",borderRadius:4,letterSpacing:1}}>
            {isBuy?"▲ BUY":"▼ SELL"}
          </span>
          <span className="mono" style={{fontSize:10,color:T.muted}}>@ {fP(pos.entry,precision)}</span>
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
        <span style={{fontSize:8,color:T.red}}>SL {fUSD(-slUSD(positionSize),false)}</span>
        <span style={{fontSize:8,color:pnl>=0?T.green:T.muted}}>{pct.toFixed(0)}% → TP {fUSD(tpUSD(positionSize),false)}</span>
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

// Fetch real 1-min candles for forex from Yahoo Finance (via serverless proxy)
async function fetchForexCandles(from,to,limit=200,interval="1m"){
  try{
    const r=await fetch("/api/forex",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({from,to,candles:true,limit,interval})});
    if(!r.ok) return null;
    const d=await r.json();
    if(d.candles?.length>5) return d;
  }catch{}
  return null;
}

async function analyzeMarketAI({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,correlations,positions,balance,news,reason,positionSize}){
  const r=await fetch("/api/analyze",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,correlations,positions,balance,news,reason,positionSize}),
  });
  if(!r.ok)return{signal:"HOLD",confidence:40,reasoning:"Error al conectar con el servidor.",news_impact:"NEUTRAL",key_factor:"Error conexión",risk:"ALTO",should_open:false};
  return r.json();
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function TradingBot(){
  const [symbol,setSymbol]       = useState("ETH/USDT");
  const asset                    = ASSETS[symbol];

  const [candles,setCandles]     = useState(()=>genCandles(ASSETS["ETH/USDT"].basePrice,80));
  const [price,setPrice]         = useState(ASSETS["ETH/USDT"].basePrice);
  const [rsi,setRsi]             = useState(50);
  const [macd,setMacd]           = useState({macd:0,signal:0,hist:0});
  const [bb,setBB]               = useState(()=>calcBB(genCandles(ASSETS["ETH/USDT"].basePrice,80).map(c=>c.c)));
  const [ema9,setEma9]           = useState(0);
  const [ema21,setEma21]         = useState(0);
  const [volTrend,setVolTrend]   = useState({current:0,avg:0,ratio:1});
  const [trend1h,setTrend1h]     = useState(0);
  const [patterns,setPatterns]   = useState([]);
  const [positions,setPositions] = useState([]);
  const [balance,setBalance]     = useState(()=>loadBalance());
  const [positionSize,setPositionSize] = useState(()=>parseFloat(localStorage.getItem("bot_posSize")||"1.00"));
  const [trades,setTrades]       = useState([]);
  const [log,setLog]             = useState([]);
  const [news,setNews]           = useState([]);
  const [newsData,setNewsData]   = useState(null);
  const [aiResult,setAiResult]   = useState(null);
  const [autoMode,setAutoMode]   = useState(false);
  const [analyzing,setAnalyzing] = useState(false);
  const [loadingNews,setLoadingNews] = useState(false);
  const [autoPhase,setAutoPhase] = useState("idle");
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
  const [activeView,setActiveView]        = useState("dashboard");
  const [livePrices,setLivePrices]        = useState({});
  const chartIntervalRef = useRef("1m");
  const bgPricesRef   = useRef({});
  const corrSignalsRef= useRef({});
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
  const balanceRef     = useRef(10000);
  const positionSizeRef= useRef(parseFloat(localStorage.getItem("bot_posSize")||"1.00"));
  const timerRef  = useRef(null);
  const countRef  = useRef(null);
  const pendingAnalysisRef = useRef(false);
  const symbolRef = useRef("ETH/USDT");

  useEffect(()=>{posRef.current=positions;},[positions]);
  useEffect(()=>{priceRef.current=price;},[price]);
  useEffect(()=>{autoRef.current=autoMode;},[autoMode]);
  useEffect(()=>{rsiRef.current=rsi;},[rsi]);
  useEffect(()=>{macdRef.current=macd;},[macd]);
  useEffect(()=>{bbRef.current=bb;},[bb]);
  useEffect(()=>{ema9Ref.current=ema9;},[ema9]);
  useEffect(()=>{ema21Ref.current=ema21;},[ema21]);
  useEffect(()=>{volRef.current=volTrend;},[volTrend]);
  useEffect(()=>{trend1hRef.current=trend1h;},[trend1h]);
  useEffect(()=>{patternsRef.current=patterns;},[patterns]);
  useEffect(()=>{newsRef.current=news;},[news]);
  useEffect(()=>{balanceRef.current=balance;},[balance]);
  useEffect(()=>{positionSizeRef.current=positionSize;localStorage.setItem("bot_posSize",String(positionSize));},[positionSize]);
  useEffect(()=>{symbolRef.current=symbol;},[symbol]);
  useEffect(()=>{consLossesRef.current=consecutiveLosses;},[consecutiveLosses]);
  useEffect(()=>{shortTrendRef.current=shortTrend;},[shortTrend]);
  useEffect(()=>{skipCyclesRef.current=skipCycles;},[skipCycles]);
  useEffect(()=>{ema200Ref.current=ema200;},[ema200]);
  useEffect(()=>{srRef.current=srLevels;},[srLevels]);
  useEffect(()=>{chartIntervalRef.current=chartInterval;},[chartInterval]);
  useEffect(()=>{corrSignalsRef.current=corrSignals;},[corrSignals]);
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
    setAiResult(null);
    setNextAnalysis(null);
    setCorrSignals({}); corrSignalsRef.current={};

    // Forex pairs with small absolute values (< 10) need 5m+ timeframe to have visible candles
    if(newAsset.type==="forex" && chartIntervalRef.current==="1m"){
      setChartInterval("5m");
      chartIntervalRef.current="5m";
    } else if(newAsset.type==="crypto" && chartIntervalRef.current!=="1m" && chartIntervalRef.current!=="5m"){
      // Keep user's chosen interval for crypto
    }

    // Use cached real rate if available — prevents TP/SL firing at wrong price
    let initPrice=newAsset.basePrice;
    if(newAsset.type==="forex"){
      const cacheKey=`${newAsset.forexFrom}_${newAsset.forexTo}`;
      if(_fxCache[cacheKey]?.rate) initPrice=_fxCache[cacheKey].rate;
    }
    const initCandles=genCandles(initPrice,200,chartIntervalRef.current);
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
    const cachedForex=newAsset.type==="forex"&&!!_fxCache[`${newAsset.forexFrom}_${newAsset.forexTo}`]?.rate;
    setForexLive(cachedForex);
    // Price not yet confirmed from live feed — block TP/SL watcher until first real tick
    setPriceVerified(cachedForex); // forex with cache = already verified; crypto = false until Binance responds
    addLog(`🔄 Cambiando a ${newSym}...`,"info");
  },[addLog]);

  /* ── Price tick ──────────────────────────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
    const tfInterval=chartInterval||"1m";
    let iv;

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
      // ── FOREX: load real 1-min candles from Yahoo Finance, then update every 15s
      const {forexFrom,forexTo}=cur;

      const applyCandles=(newCandles,rate)=>{
        if(!newCandles?.length) return;
        setCandles(newCandles);
        const closes=newCandles.map(c=>c.c);
        const volumes=newCandles.map(c=>c.v||0);
        const newBB=calcBB(closes);
        const e9=calcEMA(closes,9),e21=calcEMA(closes,21);
        const e200=calcEMA(closes,200);
        const t1h=calcTrend1h(closes);
        const sr=calcSR(newCandles);
        const pts=detectPatterns(newCandles);
        const cpats=detectCandlePatterns(newCandles);
        const st=calcShortTrend(newCandles,5);
        const allPats=[...pts,...cpats];
        const np=rate||closes.at(-1);
        setPrice(np); priceRef.current=np;
        setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
        setBB(newBB); bbRef.current=newBB;
        setEma9(e9); ema9Ref.current=e9;
        setEma21(e21); ema21Ref.current=e21;
        setEma200(e200); ema200Ref.current=e200;
        setTrend1h(t1h); trend1hRef.current=t1h;
        setPatterns(allPats); patternsRef.current=allPats;
        setShortTrend(st); shortTrendRef.current=st;
        setSrLevels(sr); srRef.current=sr;
        if(np) _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
        setForexLive(true); setPriceVerified(true);
      };

      // Initial load: real candles (1m fetched & aggregated server-side for better gap coverage)
      (async()=>{
        const data=await fetchForexCandles(forexFrom,forexTo,200,tfInterval);
        if(data?.candles?.length>5){
          applyCandles(data.candles,data.rate);
        } else {
          // Fallback: get real rate + use it as anchor for placeholder candles
          const rate=await fetchForexRateCached(forexFrom,forexTo,300000);
          if(rate){
            // Try one more time with 1m directly in case 5m aggregation failed
            const raw=await fetchForexCandles(forexFrom,forexTo,300,"1m");
            if(raw?.candles?.length>5) applyCandles(raw.candles,raw.rate);
            else applyCandles(genCandles(rate,80,tfInterval),rate);
          }
        }
      })();

      // Price update every 15s — appends to last real candle
      const tfSecs={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400}[tfInterval]||300;
      iv=setInterval(async()=>{
        const np=await fetchForexRateCached(forexFrom,forexTo,15000);
        if(!np||isNaN(np)) return;
        setCandles(prev=>{
          const updated=[...prev];
          const last={...updated[updated.length-1]};
          const nowSec=Math.floor(Date.now()/1000);
          last.c=np; last.h=Math.max(last.h,np); last.l=Math.min(last.l,np);
          if(nowSec-last.time>=tfSecs){
            updated.push({time:nowSec,o:np,c:np,h:np,l:np,v:0});
          } else {
            updated[updated.length-1]=last;
          }
          const closes=updated.map(c=>c.c);
          const newBB=calcBB(closes);
          const e9=calcEMA(closes,9),e21=calcEMA(closes,21);
          const pts=detectPatterns(updated);
          const cpats=detectCandlePatterns(updated);
          const st=calcShortTrend(updated,5);
          const e200=calcEMA(closes,200);
          const sr=calcSR(updated);
          setPrice(np); priceRef.current=np;
          _fxCache[`${forexFrom}_${forexTo}`]={rate:np,ts:Date.now()};
          setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
          setBB(newBB); bbRef.current=newBB;
          setEma9(e9); ema9Ref.current=e9;
          setEma21(e21); ema21Ref.current=e21;
          setPatterns([...pts,...cpats]); patternsRef.current=[...pts,...cpats];
          setShortTrend(st); shortTrendRef.current=st;
          setEma200(e200); ema200Ref.current=e200;
          setSrLevels(sr); srRef.current=sr;
          return updated;
        });
      },15000);
    }

    return()=>clearInterval(iv);
  },[symbol,chartInterval]);

  /* ── Binance klines for indicators ──────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
    if(cur.type!=="crypto")return;
    const load=async()=>{
      try{
        const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${cur.binance}&interval=${chartInterval}&limit=250`);
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
    if(!multiMonitor){setAssetSignals({});return;}

    const scan=async()=>{
      const results={};
      for(const [sym,cfg] of Object.entries(ASSETS)){
        try{
          let price;
          if(cfg.type==="crypto"){
            const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binance}`);
            const d=await r.json();
            price=parseFloat(d.price);
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
          results[sym]={price,signal,color,rsi:rsi.toFixed(0),pct};
        }catch{}
      }
      setAssetSignals(results);
    };
    scan();
    const iv=setInterval(scan,10000);
    return()=>clearInterval(iv);
  },[multiMonitor]);

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
          if(bgPricesRef.current[sym].length>60)bgPricesRef.current[sym].shift();
          const closes=bgPricesRef.current[sym];
          const k9=2/10,k21=2/22;
          let e9=closes[0],e21=closes[0];
          for(let i=1;i<closes.length;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*k21+e21*(1-k21);}
          const rsi=closes.length>14?calcRSI(closes):50;
          const signal=e9>e21&&rsi<70?"BUY":e9<e21&&rsi>30?"SELL":"HOLD";
          const color=signal==="BUY"?T.green:signal==="SELL"?T.red:T.muted;
          const pct=closes.length>1?(closes.at(-1)-closes[0])/closes[0]*100:0;
          results[sym]={price:p,signal,color,rsi:Math.round(rsi),pct,samples:closes.length};
        }catch{}
      }
      setForexWatch(results);
    };
    scan();
    const iv=setInterval(scan,30000);
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
  const closePosition=useCallback((posId,currentPrice,reason,posSize)=>{
    setPositions(prev=>{
      const pos=prev.find(p=>p.id===posId);
      if(!pos)return prev;
      const pnl=posPnL(pos,currentPrice,posSize);
      const posSym=pos.symbol||symbolRef.current;
      const prec=ASSETS[posSym]?.precision||ASSETS[symbolRef.current].precision;
      const emoji=reason==="TP"?"✅":reason==="SL"?"🛑":"⬜";
      addLog(`${emoji} ${reason} ${pos.type} ${posSym} @ ${fP(currentPrice,prec)} → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      setBalance(b=>{const nb=b+pnl;balanceRef.current=nb;return nb;});
      const closedTrade={...pos,exit:currentPrice,pnl,reason,time:now(),tradeTime:Math.floor(Date.now()/1000),
        symbol:posSym, activePatterns:patternsRef.current.map(p=>p.name)};
      setTrades(t=>[closedTrade,...t.slice(0,49)]);
      saveTradeLearning(closedTrade);
      setLearningStats(calcLearningStats(loadTrades()));
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
    // Guard: skip until a real price from Binance/forex API has been confirmed
    // Prevents firing at basePrice (3000 for ETH, 1.0823 for EUR) right after symbol switch
    if(!priceVerified) return;
    const posSize=positionSize;
    const tp=tpUSD(posSize); const sl=slUSD(posSize);
    posRef.current
      .filter(p=>p.symbol===symbol)
      .forEach(pos=>{
        const pnl=posPnL(pos,price,posSize);
        if(pnl>=tp) closePosition(pos.id,price,"TP",posSize);
        else if(pnl<=-sl) closePosition(pos.id,price,"SL",posSize);
      });
  },[price,symbol,priceVerified,closePosition,positionSize]);

  /* ── TP / SL watcher — non-active symbols (uses livePrices) ──────────── */
  useEffect(()=>{
    const posSize=positionSize;
    const tp=tpUSD(posSize); const sl=slUSD(posSize);
    posRef.current
      .filter(p=>p.symbol&&p.symbol!==symbol)  // only positions with explicit symbol, not current
      .forEach(pos=>{
        const cp=livePrices[pos.symbol];
        const cfg=ASSETS[pos.symbol];
        // Skip if no real price loaded yet (guard against basePrice triggering SL)
        if(!cp||cp===cfg?.basePrice) return;
        const pnl=posPnL(pos,cp,posSize);
        if(pnl>=tp) closePosition(pos.id,cp,"TP",posSize);
        else if(pnl<=-sl) closePosition(pos.id,cp,"SL",posSize);
      });
  },[livePrices,symbol,closePosition,positionSize]);

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
    // ── Trading session filter for forex (don't trade during Asian dead hours)
    const curAsset=ASSETS[symbolRef.current];
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
    let dynamicMinConf=60; // base threshold
    if(trades.length>=10){
      const recent=trades.slice(0,20);
      const recentWR=recent.filter(t=>t.pnl>0).length/recent.length;
      // Tighten confidence requirement when win rate is poor
      if(recentWR<0.35)      dynamicMinConf=78; // losing badly → very strict
      else if(recentWR<0.45) dynamicMinConf=72; // below avg → strict
      else if(recentWR<0.55) dynamicMinConf=65; // around avg → slightly cautious
      else if(recentWR>=0.65)dynamicMinConf=58; // winning well → slight relaxation
      // Per-direction adjustment based on recent directional performance
      const recentBuys=recent.filter(t=>t.type==="BUY");
      const recentSells=recent.filter(t=>t.type==="SELL");
      const buyWR=recentBuys.length>=3?recentBuys.filter(t=>t.pnl>0).length/recentBuys.length:null;
      const sellWR=recentSells.length>=3?recentSells.filter(t=>t.pnl>0).length/recentSells.length:null;
      if(buyWR!==null&&buyWR<0.3) dynamicMinConf=Math.max(dynamicMinConf,75); // BUYs losing a lot
      if(sellWR!==null&&sellWR<0.3) dynamicMinConf=Math.max(dynamicMinConf,75); // SELLs losing a lot
    }

    addLog(`🔍 Analizando ${symbolRef.current}: ${reason} | umbral dinámico: ${dynamicMinConf}%`,"info");
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
        news:newsRef.current,    reason,
        positionSize:positionSizeRef.current,
      });
      setAiResult(result);
      addLog(`📡 ${result.signal} (${result.confidence}%) — ${result.key_factor}`,
        result.signal==="BUY"?"buy":result.signal==="SELL"?"sell":"info");

      if(autoRef.current){
        const activeSym=symbolRef.current;
        const symSlots=MAX_POSITIONS-posRef.current.filter(p=>p.symbol===activeSym).length;
        if(result.should_open&&result.signal!=="HOLD"&&symSlots>0&&result.confidence>=dynamicMinConf){
          const isBuy=result.signal==="BUY";
          const cp=priceRef.current;
          const prec=ASSETS[activeSym].precision;
          const mainPos={type:result.signal,entry:cp,id:Date.now()+Math.random(),
            symbol:activeSym,openTime:Date.now()};

          // ── Open correlated positions on all forex pairs with a confirmed correlation
          const corrPositions=[];
          const activeAsset=ASSETS[activeSym];
          if(activeAsset?.type==="forex"){
            const corrs=activeAsset.correlations||{};
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
              corrPositions.push({
                type:corrSignal,entry:corrPrice,id:Date.now()+Math.random()+corrPositions.length*0.001,
                symbol:corrSym,openTime:Date.now(),correlatedWith:activeSym,
              });
              addLog(`🔗 ${corrSignal==="BUY"?"🟢":"🔴"} CORR ${corrSignal} ${corrSym} @ ${fP(corrPrice,corrAsset.precision)} (${corrDir>0?"↑↑":"↓↑"} ${activeSym})`,corrSignal==="BUY"?"buy":"sell");
            }
          }

          setPositions(p=>[...p,mainPos,...corrPositions]);
          addLog(`${isBuy?"🟢 BUY":"🔴 SELL"} ${activeSym} @ ${fP(cp,prec)} | TP:+${fUSD(tpUSD(positionSizeRef.current))} SL:-${fUSD(slUSD(positionSizeRef.current))}${corrPositions.length?` + ${corrPositions.length} correlacionadas`:""}`,isBuy?"buy":"sell");
          setAutoPhase("monitoring");
        } else {
          const why=!result.should_open?"sin confluencia clara"
            :result.confidence<dynamicMinConf?`confianza ${result.confidence}% < umbral ${dynamicMinConf}%`
            :symSlots===0?"slots llenos":"señal HOLD";
          addLog(`⏸ Sin abrir — ${why}. Esperando próximo ciclo.`,"info");
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

  /* ── Auto loop ───────────────────────────────────────────────────────── */
  useEffect(()=>{
    clearInterval(timerRef.current);
    clearInterval(countRef.current);
    if(!autoMode){setAutoPhase("idle");setNextAnalysis(null);return;}

    addLog(`🤖 AUTO ACTIVADO — TP:+${fUSD(tpUSD(positionSizeRef.current))} (${(TAKE_PROFIT_PCT*100).toFixed(2)}%) | SL:-${fUSD(slUSD(positionSizeRef.current))} | Máx ${MAX_POSITIONS} pos`,"info");
    runAnalysis("Inicio modo automático");

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
    },ANALYSIS_INTERVAL_MS);

    return()=>{clearInterval(timerRef.current);clearInterval(countRef.current);};
  },[autoMode]);

  /* ── React to TP hit → re-analyze ───────────────────────────────────── */
  useEffect(()=>{
    if(!pendingAnalysisRef.current||analyzing)return;
    if(autoRef.current&&posRef.current.length<MAX_POSITIONS){
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
    closePosition(id,priceRef.current,"MANUAL",positionSizeRef.current);
  },[closePosition]);

  /* ── Stats ───────────────────────────────────────────────────────────── */
  const symPositions=positions.filter(p=>p.symbol===symbol);
  const unrealized=symPositions.reduce((s,p)=>s+posPnL(p,price,positionSize),0);
  const totalUnrealized=positions.reduce((s,p)=>{
    const cp=livePricesRef.current[p.symbol]||price;
    return s+posPnL(p,cp,positionSize);
  },0);
  const winCount=trades.filter(t=>t.pnl>0).length;
  const winRate=trades.length?Math.round(winCount/trades.length*100):0;
  const sigCol=aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.yellow;
  const nextSec=nextAnalysis?Math.max(0,Math.round(nextAnalysis/1000)):null;

  const phaseInfo={
    idle:              {label:"INACTIVO",             color:T.muted,  desc:"Activa el modo AUTO para comenzar."},
    analyzing:         {label:"⏳ ANALIZANDO",         color:T.yellow, desc:"Consultando IA con indicadores y noticias en tiempo real..."},
    monitoring:        {label:"📡 MONITOREANDO",       color:T.accent, desc:`Vigilando ${positions.length} posición(es). TP:+${fUSD(tpUSD(positionSize))} (${(TAKE_PROFIT_PCT*100).toFixed(2)}%) | SL:-${fUSD(slUSD(positionSize))}`},
    waiting_conditions:{label:"⏸ ESPERANDO",          color:T.orange, desc:`Sin condiciones favorables. Próximo análisis en ${nextSec??"-"}s`},
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
                {asset.type==="crypto"?"EN VIVO • BINANCE":forexLive?"EN VIVO • Forex":"CARGANDO PRECIO REAL..."}
              </span>
            </div>
            <div className="mono" style={{fontSize:26,fontWeight:700,color:T.accent}}>{fP(price,asset.precision)}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:1}}>{symbol} · Paper Trading</div>
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
                <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>FOREX WATCHLIST · {FOREX_SYMS.length} pares · actualiza cada 30s · señales EMA+RSI</span>
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
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
          </div>
        )}

        {/* ── NAVIGATION ── */}
        <div style={{display:"flex",gap:0,marginBottom:12,borderBottom:`1px solid ${T.border}`,paddingBottom:0}}>
          {[
            {id:"dashboard", label:"📊 Dashboard"},
            {id:"operations", label:`💼 Operaciones${positions.length>0?` (${positions.length})`:""}`,
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

        {/* ══════════ VISTA: OPERACIONES ══════════ */}
        {activeView==="operations"&&(()=>{
          const formatDuration=(ms)=>{
            const s=Math.floor(ms/1000);
            if(s<60)return `${s}s`;
            const m=Math.floor(s/60);
            if(m<60)return `${m}m ${s%60}s`;
            return `${Math.floor(m/60)}h ${m%60}m`;
          };
          const allUnrealized=positions.reduce((s,p)=>{
            const cp=livePrices[p.symbol]||p.entry;
            return s+posPnL(p,cp,positionSize);
          },0);
          const bestPos=positions.length?positions.reduce((b,p)=>{
            const cp=livePrices[p.symbol]||p.entry;
            return posPnL(p,cp,positionSize)>posPnL(b,livePrices[b.symbol]||b.entry,positionSize)?p:b;
          },positions[0]):null;
          const worstPos=positions.length?positions.reduce((w,p)=>{
            const cp=livePrices[p.symbol]||p.entry;
            return posPnL(p,cp,positionSize)<posPnL(w,livePrices[w.symbol]||w.entry,positionSize)?p:w;
          },positions[0]):null;
          // Group by symbol for summary
          const bySymbol={};
          positions.forEach(p=>{
            const sym=p.symbol||symbol;
            if(!bySymbol[sym])bySymbol[sym]={positions:[],pnl:0};
            const cp=livePrices[sym]||p.entry;
            bySymbol[sym].positions.push(p);
            bySymbol[sym].pnl+=posPnL(p,cp,positionSize);
          });
          return(
            <div style={{animation:"fadeUp .3s ease"}}>
              {/* Summary banner */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:7,marginBottom:12}}>
                {[
                  {l:"BALANCE TOTAL",   v:`$${balance.toFixed(2)}`,                 c:T.accent},
                  {l:"NO REALIZ GLOBAL",v:fUSD(allUnrealized),                       c:allUnrealized>=0?T.green:T.red},
                  {l:"P&L ACUMULADO",  v:fUSD(totalProfit),                         c:totalProfit>=0?T.green:T.red},
                  {l:"POS. ABIERTAS",  v:`${positions.length}`,                     c:positions.length?T.yellow:T.muted},
                  {l:"WIN RATE GLOBAL", v:`${winRate}%`,                            c:winRate>=50?T.green:T.red},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:3}}>{l}</div>
                    <div className="mono" style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Best / Worst */}
              {positions.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:12}}>
                  {[{label:"MEJOR POSICIÓN",pos:bestPos,col:T.green},{label:"PEOR POSICIÓN",pos:worstPos,col:T.red}].map(({label,pos,col})=>{
                    if(!pos)return null;
                    const cp=livePrices[pos.symbol]||pos.entry;
                    const pnl=posPnL(pos,cp,positionSize);
                    const prec=ASSETS[pos.symbol]?.precision||5;
                    return(
                      <div key={label} style={{background:T.card,border:`1px solid ${col}30`,borderRadius:7,padding:"10px 14px",
                        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div>
                          <div style={{fontSize:7,color:T.muted,letterSpacing:2,marginBottom:3}}>{label}</div>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <span style={{fontSize:10,fontWeight:700,color:T.accent,background:`${T.accent}15`,padding:"2px 8px",borderRadius:4}}>{pos.symbol}</span>
                            <span style={{fontSize:10,color:pos.type==="BUY"?T.green:T.red,fontWeight:700}}>{pos.type}</span>
                            <span className="mono" style={{fontSize:10,color:T.muted}}>@ {fP(pos.entry,prec)}</span>
                          </div>
                        </div>
                        <div className="mono" style={{fontSize:20,fontWeight:700,color:col}}>{fUSD(pnl)}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* By symbol summary */}
              {Object.keys(bySymbol).length>0&&(
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:8}}>POSICIONES POR ACTIVO</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {Object.entries(bySymbol).map(([sym,data])=>{
                      const col=data.pnl>=0?T.green:T.red;
                      return(
                        <div key={sym} onClick={()=>{handleSymbolChange(sym);setActiveView("dashboard");}}
                          style={{background:`${col}0a`,border:`1px solid ${col}30`,borderRadius:6,
                            padding:"7px 12px",cursor:"pointer",minWidth:110,textAlign:"center"}}>
                          <div style={{fontSize:9,fontWeight:700,color:T.accent,marginBottom:3}}>{sym}</div>
                          <div style={{fontSize:8,color:T.muted,marginBottom:2}}>{data.positions.length} pos</div>
                          <div className="mono" style={{fontSize:12,fontWeight:700,color:col}}>{fUSD(data.pnl)}</div>
                          <div style={{fontSize:7,color:T.accent,marginTop:3}}>→ Ver gráfica</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All open positions table */}
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:10}}>
                  TODAS LAS POSICIONES ABIERTAS {positions.length===0&&"— Ninguna activa"}
                </div>
                {positions.length===0?(
                  <div style={{fontSize:11,color:T.muted,fontStyle:"italic",padding:"20px",textAlign:"center"}}>
                    No hay posiciones abiertas. Activa el modo AUTO o analiza un par para comenzar.
                  </div>
                ):(
                  <>
                    {/* Table header */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 60px 100px 100px 80px 120px 80px 40px",
                      gap:6,padding:"4px 8px",marginBottom:4}}>
                      {["ACTIVO","TIPO","ENTRADA","ACTUAL","PnL","PROGRESO TP","DURACIÓN",""].map(h=>(
                        <div key={h} style={{fontSize:7,color:T.muted,letterSpacing:1}}>{h}</div>
                      ))}
                    </div>
                    {positions.map(pos=>{
                      const sym=pos.symbol||symbol;
                      const cfg=ASSETS[sym];
                      const prec=cfg?.precision||5;
                      const cp=livePrices[sym]||pos.entry;
                      const pnl=posPnL(pos,cp,positionSize);
                      const pct=Math.min(100,Math.max(0,(pnl/tpUSD(positionSize))*100));
                      const pctChange=(cp-pos.entry)/pos.entry*100;
                      const col=pnl>=0?T.green:T.red;
                      const isBuy=pos.type==="BUY";
                      const dur=pos.openTime?formatDuration(Date.now()-pos.openTime):"—";
                      const tp=isBuy?pos.entry*(1+TAKE_PROFIT_PCT):pos.entry*(1-TAKE_PROFIT_PCT);
                      const sl=isBuy?pos.entry*(1-STOP_LOSS_PCT):pos.entry*(1+STOP_LOSS_PCT);
                      return(
                        <div key={pos.id} className="fade-up" style={{
                          display:"grid",gridTemplateColumns:"1fr 60px 100px 100px 80px 120px 80px 40px",
                          gap:6,padding:"8px",marginBottom:4,borderRadius:6,
                          background:`${col}06`,border:`1px solid ${col}20`,alignItems:"center",
                        }}>
                          {/* Activo */}
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:10,fontWeight:700,color:T.accent,
                              background:`${T.accent}15`,padding:"2px 7px",borderRadius:4}}>{sym}</span>
                            {cfg?.type==="forex"&&<span style={{fontSize:7,color:T.muted}}>FOREX</span>}
                          </div>
                          {/* Tipo */}
                          <span style={{fontSize:10,fontWeight:700,color:isBuy?T.green:T.red,
                            background:`${isBuy?T.green:T.red}15`,padding:"2px 6px",borderRadius:3,textAlign:"center"}}>
                            {isBuy?"▲ BUY":"▼ SELL"}
                          </span>
                          {/* Entrada */}
                          <div>
                            <div className="mono" style={{fontSize:10,color:T.muted}}>{fP(pos.entry,prec)}</div>
                            <div style={{fontSize:7,color:T.muted}}>TP:{fP(tp,prec)}</div>
                            <div style={{fontSize:7,color:T.muted}}>SL:{fP(sl,prec)}</div>
                          </div>
                          {/* Actual */}
                          <div>
                            <div className="mono" style={{fontSize:10,color:T.accent,fontWeight:700}}>{fP(cp,prec)}</div>
                            <div style={{fontSize:7,color:pctChange>=0?T.green:T.red}}>{fPct(pctChange)}</div>
                          </div>
                          {/* PnL */}
                          <span className="mono" style={{fontSize:13,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
                          {/* Progress bar */}
                          <div>
                            <div style={{height:4,background:T.dim,borderRadius:2,overflow:"hidden",marginBottom:2}}>
                              <div style={{height:"100%",width:`${pct}%`,background:col,borderRadius:2,transition:"width .4s"}}/>
                            </div>
                            <div style={{fontSize:7,display:"flex",justifyContent:"space-between"}}>
                              <span style={{color:T.red}}>SL -{fUSD(slUSD(positionSize),false)}</span>
                              <span style={{color:col}}>{pct.toFixed(0)}%</span>
                              <span style={{color:T.green}}>TP +{fUSD(tpUSD(positionSize),false)}</span>
                            </div>
                          </div>
                          {/* Duración */}
                          <span className="mono" style={{fontSize:9,color:T.muted,textAlign:"center"}}>{dur}</span>
                          {/* Cerrar */}
                          <button onClick={()=>{
                            closePosition(pos.id,cp,"MANUAL",positionSizeRef.current);
                          }} style={{background:"transparent",border:`1px solid ${T.muted}40`,
                            color:T.muted,borderRadius:4,padding:"3px 7px",cursor:"pointer",fontSize:10}}>✕</button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Historial de trades cerrados */}
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:8}}>
                  HISTORIAL COMPLETO · {trades.length} operaciones cerradas
                </div>
                {trades.length===0?(
                  <div style={{fontSize:11,color:T.muted,fontStyle:"italic",padding:"10px"}}>Sin historial aún.</div>
                ):(
                  <>
                    {/* Resumen rápido */}
                    <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                      {Object.keys(ASSETS).map(sym=>{
                        const symTrades=trades.filter(t=>t.symbol===sym);
                        if(!symTrades.length)return null;
                        const symPnl=symTrades.reduce((s,t)=>s+t.pnl,0);
                        const symWR=Math.round(symTrades.filter(t=>t.pnl>0).length/symTrades.length*100);
                        return(
                          <div key={sym} style={{background:T.dim,borderRadius:5,padding:"5px 10px",minWidth:90,textAlign:"center"}}>
                            <div style={{fontSize:8,fontWeight:700,color:T.accent}}>{sym}</div>
                            <div className="mono" style={{fontSize:10,color:symPnl>=0?T.green:T.red}}>{fUSD(symPnl)}</div>
                            <div style={{fontSize:7,color:T.muted}}>WR {symWR}% ({symTrades.length})</div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Trade list */}
                    {trades.slice(0,30).map((t,i)=>{
                      const prec=ASSETS[t.symbol]?.precision||5;
                      const reasonCol=t.reason==="TP"?T.green:t.reason==="SL"?T.red:T.muted;
                      return(
                        <div key={i} style={{display:"grid",gridTemplateColumns:"80px 50px 28px 80px 80px 50px 1fr",
                          gap:6,padding:"5px 6px",borderBottom:`1px solid ${T.border}20`,alignItems:"center",fontSize:9}}>
                          <span style={{color:T.accent,fontWeight:700}}>{t.symbol||"—"}</span>
                          <span style={{color:t.type==="BUY"?T.green:T.red,fontWeight:700}}>{t.type}</span>
                          <span style={{fontSize:7,color:reasonCol,background:`${reasonCol}15`,
                            padding:"1px 4px",borderRadius:3,textAlign:"center"}}>{t.reason}</span>
                          <span className="mono" style={{color:T.muted,fontSize:8}}>{fP(t.entry,prec)}</span>
                          <span className="mono" style={{color:T.muted,fontSize:8}}>{fP(t.exit,prec)}</span>
                          <span className="mono" style={{color:t.pnl>=0?T.green:T.red,fontWeight:700}}>{fUSD(t.pnl)}</span>
                          <span style={{color:T.muted,fontSize:7}}>{t.time}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ══════════ VISTA: DASHBOARD ══════════ */}
        {activeView==="dashboard"&&(<>

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
        {(()=>{
          const emaCross=ema9>ema21?"ALCISTA":"BAJISTA";
          const emaCrossCol=ema9>ema21?T.green:T.red;
          const volLabel=volTrend.ratio>1.5?"ALTO":volTrend.ratio<0.7?"BAJO":"NORMAL";
          const volCol=volTrend.ratio>1.5?T.green:volTrend.ratio<0.7?T.muted:T.yellow;
          const trend1hCol=trend1h>0?T.green:T.red;
          const indicators=[
            {l:"RSI (14)",    v:rsi.toFixed(1),        c:rsi<30?T.green:rsi>70?T.red:T.yellow, s:rsi<30?"SOBREVENTA":rsi>70?"SOBRECOMPRA":"NEUTRAL"},
            {l:"MACD HIST",  v:macd.hist.toFixed(asset.precision>3?5:2), c:macd.hist>0?T.green:T.red, s:macd.hist>0?"ALCISTA":"BAJISTA"},
            {l:"BB UPPER",   v:fP(bb.upper,asset.precision), c:price>bb.upper?T.red:T.muted, s:price>bb.upper?"⚠ SOBRE BANDA":"normal"},
            {l:"BB LOWER",   v:fP(bb.lower,asset.precision), c:price<bb.lower?T.green:T.muted, s:price<bb.lower?"⚠ BAJO BANDA":"normal"},
            {l:"EMA 9/21",   v:`${fP(ema9,asset.precision>3?4:1)}`, c:emaCrossCol, s:`CRUCE ${emaCross}`},
            {l:"VOLUMEN",    v:`×${volTrend.ratio.toFixed(2)}`, c:volCol, s:`${volLabel} vs promedio`},
            {l:"TENDENCIA 1H",v:`${trend1h>=0?"+":""}${trend1h.toFixed(3)}%`, c:trend1hCol, s:trend1h>0?"ALCISTA 1H":"BAJISTA 1H"},
            {l:"EMA SEÑAL",  v:ema9>ema21?"BUY":"SELL", c:emaCrossCol, s:ema9>ema21?"EMA9 > EMA21":"EMA9 < EMA21"},
          ];
          return(
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:10}}>
              {indicators.map(({l,v,c,s})=>(
                <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 12px"}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:2}}>{l}</div>
                  <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                  <div style={{fontSize:8,color:c,marginTop:2,opacity:.75}}>{s}</div>
                </div>
              ))}
            </div>
          );
        })()}

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
              <div style={{display:"grid",gridTemplateColumns:`repeat(${total},1fr)`,gap:6}}>
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
              positionSize={positionSize}
            />
          </div>
        </div>

        {/* POSITIONS del símbolo activo */}
        {symPositions.length>0&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:6}}>POSICIONES ABIERTAS — {symbol} — TP +{fUSD(tpUSD(positionSize),false)} ({(TAKE_PROFIT_PCT*100).toFixed(2)}%) | SL -{fUSD(slUSD(positionSize),false)}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {symPositions.map(pos=><PosRow key={pos.id} pos={pos} price={price} precision={asset.precision} positionSize={positionSize} onClose={()=>manualClose(pos.id)}/>)}
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
                const pnl=pos?posPnL(pos,price,positionSize):null;
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

        {/* AI LAST SIGNAL */}
        {aiResult&&(
          <div className="fade-up" style={{background:T.card,border:`1px solid ${sigCol}40`,borderRadius:8,padding:"12px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:8,color:T.muted,letterSpacing:3,marginBottom:3}}>ÚLTIMO ANÁLISIS IA · {symbol}</div>
                <div style={{fontSize:28,fontWeight:900,letterSpacing:3,color:sigCol}}>{aiResult.signal}</div>
                <div style={{fontSize:9,color:T.muted,marginTop:2}}>
                  Confianza <span style={{color:sigCol,fontWeight:700}}>{aiResult.confidence}%</span>
                  {" "}· Riesgo <span style={{color:aiResult.risk==="BAJO"?T.green:aiResult.risk==="ALTO"?T.red:T.yellow}}>{aiResult.risk}</span>
                  {" "}· Noticias <span style={{color:aiResult.news_impact==="BULLISH"?T.green:aiResult.news_impact==="BEARISH"?T.red:T.muted}}>{aiResult.news_impact}</span>
                  {" "}· <span style={{color:aiResult.should_open?T.green:T.orange}}>{aiResult.should_open?"ABRIR":"NO ABRIR"}</span>
                </div>
              </div>
              <div style={{background:`${sigCol}12`,border:`1px solid ${sigCol}30`,borderRadius:6,padding:"6px 12px",textAlign:"center",maxWidth:140}}>
                <div style={{fontSize:8,color:T.muted,marginBottom:2}}>FACTOR CLAVE</div>
                <div style={{fontSize:10,color:sigCol,fontWeight:600,lineHeight:1.3}}>{aiResult.key_factor}</div>
              </div>
            </div>
            <div style={{background:T.dim,borderRadius:5,padding:"9px 12px",fontSize:11,color:T.text,lineHeight:1.65,borderLeft:`3px solid ${sigCol}`}}>
              {aiResult.reasoning}
            </div>
            {!autoMode&&aiResult.signal!=="HOLD"&&positions.filter(p=>!p.symbol||p.symbol===symbol).length<MAX_POSITIONS&&(
              <button onClick={()=>{
                const pos={type:aiResult.signal,entry:priceRef.current,id:Date.now(),symbol,openTime:Date.now()};
                setPositions(p=>[...p,pos]);
                addLog(`${aiResult.signal==="BUY"?"🟢":"🔴"} ${aiResult.signal} manual @ ${fP(priceRef.current,asset.precision)}`,aiResult.signal==="BUY"?"buy":"sell");
              }} style={{marginTop:10,width:"100%",background:`${sigCol}18`,border:`1px solid ${sigCol}`,
                color:sigCol,borderRadius:7,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,letterSpacing:1}}>
                ▶ EJECUTAR {aiResult.signal} MANUALMENTE (pos {positions.filter(p=>!p.symbol||p.symbol===symbol).length+1}/{MAX_POSITIONS})
              </button>
            )}
          </div>
        )}

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

        {/* POSITION SIZE CONTROL */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>TAMAÑO DE POSICIÓN (USD notional)</span>
            <span className="mono" style={{fontSize:11,color:T.accent,fontWeight:700}}>${positionSize.toFixed(2)}</span>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {[0.10,0.50,1.00,5.00,10.00,50.00,100.00].map(v=>(
              <button key={v} onClick={()=>setPositionSize(v)}
                style={{flex:"1 1 auto",minWidth:44,background:positionSize===v?`${T.accent}22`:"transparent",
                  border:`1px solid ${positionSize===v?T.accent:T.border}`,color:positionSize===v?T.accent:T.muted,
                  borderRadius:6,padding:"6px 4px",cursor:"pointer",fontSize:10,fontWeight:positionSize===v?700:400}}>
                ${v.toFixed(2)}
              </button>
            ))}
            <input type="number" min="0.01" step="0.01"
              value={positionSize}
              onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0)setPositionSize(v);}}
              style={{width:70,background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,
                padding:"6px 8px",fontSize:10,fontFamily:"monospace",outline:"none"}}
            />
          </div>
          <div style={{fontSize:8,color:T.muted,marginTop:5}}>
            TP +{fUSD(tpUSD(positionSize),false)} ({(TAKE_PROFIT_PCT*100).toFixed(2)}%) · SL -{fUSD(slUSD(positionSize),false)} ({(STOP_LOSS_PCT*100).toFixed(2)}%)
          </div>
        </div>

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

        {/* DISCLAIMER */}
        <div style={{fontSize:8,color:T.muted,textAlign:"center",lineHeight:1.9,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
          ⚠️ MODO PAPER TRADING — Dinero 100% simulado · Crypto en vivo vía Binance · EUR/USD en vivo vía Open Exchange Rates (ECB) · TP +$3.00 · SL -$2.00<br/>
          Las señales son educativas y no garantizan resultados en mercados reales. Opera siempre con responsabilidad.
        </div>

        </>)}{/* end dashboard view */}

      </div>
    </>
  );
}
