import { useState, useEffect, useRef, useCallback } from "react";

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
  "ETH/USDT": { label:"ETH/USDT", type:"crypto", binance:"ETHUSDT", tvSymbol:"BINANCE:ETHUSDT", avTickers:"ETH",              precision:2, basePrice:3000  },
  "BTC/USDT": { label:"BTC/USDT", type:"crypto", binance:"BTCUSDT", tvSymbol:"BINANCE:BTCUSDT", avTickers:"BTC",              precision:2, basePrice:65000 },
  "SOL/USDT": { label:"SOL/USDT", type:"crypto", binance:"SOLUSDT", tvSymbol:"BINANCE:SOLUSDT", avTickers:"SOL",              precision:3, basePrice:150   },
  "EUR/USD":  { label:"EUR/USD",  type:"forex",  binance:null,      tvSymbol:"FX:EURUSD",       avTickers:"FOREX:EUR,FOREX:USD", precision:5, basePrice:1.0823 },
};

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
const TAKE_PROFIT_USD    = 3.00;
const STOP_LOSS_USD      = 2.00;
const MAX_POSITIONS      = 5;
const POSITION_USD       = 1000;
const ANALYSIS_INTERVAL_MS = 28000;

/* ─── UTILS ─────────────────────────────────────────────────────────────── */
const fP   = (n, p) => Number(n).toFixed(p);
const fUSD = (n, sign=true) => (sign&&n>=0?"+":"")+`$${Math.abs(n).toFixed(2)}`;
const fPct = n => (n>=0?"+":"")+n.toFixed(3)+"%";
const now  = () => new Date().toLocaleTimeString("es");

function posPnL(pos, price){
  const dir = pos.type==="BUY" ? 1 : -1;
  return dir * (price - pos.entry) / pos.entry * POSITION_USD;
}

function genCandles(base=1.0823, n=80){
  const arr=[]; let p=base;
  const vol = base > 100 ? base*0.003 : 0.0022;
  for(let i=0;i<n;i++){
    const d=(Math.random()-.496)*vol;
    const o=p, c=p+d;
    arr.push({o,c,h:Math.max(o,c)+Math.random()*vol*.2,l:Math.min(o,c)-Math.random()*vol*.2});
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
      results.push({name:"Double Bottom", signal:"BULLISH", type:"REVERSAL", conf:72, emoji:"W"});
  }

  // ── Double Top (BEARISH REVERSAL)
  if(highs.length>=2){
    const [h1,h2]=highs.slice(-2);
    const diff=Math.abs(h1.price-h2.price)/h1.price;
    const gap=h2.idx-h1.idx;
    if(diff<tol && gap>=5 && gap<=45)
      results.push({name:"Double Top", signal:"BEARISH", type:"REVERSAL", conf:72, emoji:"M"});
  }

  // ── Head & Shoulders (BEARISH REVERSAL)
  if(highs.length>=3){
    const [h1,h2,h3]=highs.slice(-3);
    const shoulderDiff=Math.abs(h1.price-h3.price)/h1.price;
    if(shoulderDiff<tol && h2.price>h1.price*1.01 && h2.price>h3.price*1.01)
      results.push({name:"Head & Shoulders", signal:"BEARISH", type:"REVERSAL", conf:76, emoji:"∩"});
  }

  // ── Inverse Head & Shoulders (BULLISH REVERSAL)
  if(lows.length>=3){
    const [l1,l2,l3]=lows.slice(-3);
    const shoulderDiff=Math.abs(l1.price-l3.price)/l1.price;
    if(shoulderDiff<tol && l2.price<l1.price*0.99 && l2.price<l3.price*0.99)
      results.push({name:"Inv. Head & Shoulders", signal:"BULLISH", type:"REVERSAL", conf:76, emoji:"∪"});
  }

  // ── Ascending Triangle (BULLISH CONTINUATION)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(Math.abs(h1.price-h2.price)/h1.price<0.015 && l2.price>l1.price*1.005)
      results.push({name:"Ascending Triangle", signal:"BULLISH", type:"CONTINUATION", conf:68, emoji:"△"});
  }

  // ── Descending Triangle (BEARISH CONTINUATION)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(Math.abs(l1.price-l2.price)/l1.price<0.015 && h2.price<h1.price*0.995)
      results.push({name:"Descending Triangle", signal:"BEARISH", type:"CONTINUATION", conf:68, emoji:"▽"});
  }

  // ── Symmetrical Triangle (NEUTRAL → esperar ruptura)
  if(highs.length>=2 && lows.length>=2){
    const [h1,h2]=highs.slice(-2);
    const [l1,l2]=lows.slice(-2);
    if(h2.price<h1.price*0.995 && l2.price>l1.price*1.005)
      results.push({name:"Symmetrical Triangle", signal:"NEUTRAL", type:"CONTINUATION", conf:60, emoji:"◇"});
  }

  // ── Bullish Flag (BULLISH CONTINUATION)
  if(recent.length>=20){
    const pole=recent.slice(-20,-10), flag=recent.slice(-10);
    const poleChg=(pole.at(-1).c-pole[0].c)/pole[0].c;
    const flagChg=(flag.at(-1).c-flag[0].c)/flag[0].c;
    if(poleChg>0.015 && flagChg<0 && Math.abs(flagChg)<poleChg*0.5)
      results.push({name:"Bullish Flag", signal:"BULLISH", type:"CONTINUATION", conf:70, emoji:"⚑"});
    if(poleChg<-0.015 && flagChg>0 && Math.abs(flagChg)<Math.abs(poleChg)*0.5)
      results.push({name:"Bearish Flag", signal:"BEARISH", type:"CONTINUATION", conf:70, emoji:"⚐"});
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

/* ─── TRADINGVIEW CHART ─────────────────────────────────────────────────── */
function TradingViewChart({tvSymbol}){
  const containerRef=useRef(null);

  useEffect(()=>{
    const container=containerRef.current;
    if(!container)return;
    container.innerHTML="";

    const widget=document.createElement("div");
    widget.className="tradingview-widget-container__widget";
    widget.style.height="370px";
    widget.style.width="100%";
    container.appendChild(widget);

    const script=document.createElement("script");
    script.type="text/javascript";
    script.src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async=true;
    script.innerHTML=JSON.stringify({
      autosize:true, symbol:tvSymbol, interval:"5",
      timezone:"America/Bogota", theme:"dark", style:"1", locale:"es",
      withdateranges:true, hide_side_toolbar:false, allow_symbol_change:false,
      calendar:false, support_host:"https://www.tradingview.com",
      backgroundColor:"rgba(8,13,28,1)", gridColor:"rgba(21,32,53,0.3)",
    });
    container.appendChild(script);

    return()=>{container.innerHTML="";};
  },[tvSymbol]);

  return(
    <div ref={containerRef} className="tradingview-widget-container" style={{width:"100%",height:370}}/>
  );
}

/* ─── POSITION ROW ───────────────────────────────────────────────────────── */
function PosRow({pos, price, precision, onClose}){
  const pnl=posPnL(pos,price);
  const col=pnl>=0?T.green:T.red;
  const pct=Math.min(100,Math.max(0,(pnl/TAKE_PROFIT_USD)*100));
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
        <span style={{fontSize:8,color:T.red}}>SL {fUSD(-STOP_LOSS_USD,false)}</span>
        <span style={{fontSize:8,color:pnl>=0?T.green:T.muted}}>{pct.toFixed(0)}% → TP {fUSD(TAKE_PROFIT_USD,false)}</span>
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

async function analyzeMarketAI({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,positions,balance,news,reason}){
  const r=await fetch("/api/analyze",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({symbol,price,rsi,macd,bb,ema9,ema21,volRatio,trend1h,patterns,positions,balance,news,reason}),
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
  const [balance,setBalance]     = useState(10000);
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
  const [closedCount,setClosedCount]   = useState(0);
  const [totalProfit,setTotalProfit]   = useState(0);

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
  const balanceRef= useRef(10000);
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
  useEffect(()=>{symbolRef.current=symbol;},[symbol]);

  const addLog=useCallback((msg,type="info")=>{
    setLog(p=>[{msg,type,time:now()},...p.slice(0,99)]);
  },[]);

  /* ── Symbol change ───────────────────────────────────────────────────── */
  const handleSymbolChange=useCallback((newSym)=>{
    if(newSym===symbolRef.current)return;
    const newAsset=ASSETS[newSym];
    setSymbol(newSym);
    setAutoMode(false);
    setAutoPhase("idle");
    setPositions([]);
    setAiResult(null);
    setNextAnalysis(null);
    const initCandles=genCandles(newAsset.basePrice,80);
    setCandles(initCandles);
    setPrice(newAsset.basePrice);
    priceRef.current=newAsset.basePrice;
    const closes=initCandles.map(c=>c.c);
    const initBB=calcBB(closes);
    setRsi(calcRSI(closes));
    setMacd(calcMACD(closes));
    setBB(initBB);
    bbRef.current=initBB;
    addLog(`🔄 Cambiando a ${newSym}...`,"info");
  },[addLog]);

  /* ── Price tick ──────────────────────────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
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
          setCandles(prev=>{
            const updated=[...prev];
            const last={...updated[updated.length-1]};
            last.c=np;
            last.h=Math.max(last.h,np);
            last.l=Math.min(last.l,np);
            updated[updated.length-1]=last;
            const closes=updated.map(c=>c.c);
            const newBB=calcBB(closes);
            const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
            const t1h=calcTrend1h(closes);
            const pts=detectPatterns(updated);
            setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
            setBB(newBB); bbRef.current=newBB;
            setEma9(e9); ema9Ref.current=e9;
            setEma21(e21); ema21Ref.current=e21;
            setTrend1h(t1h); trend1hRef.current=t1h;
            setPatterns(pts); patternsRef.current=pts;
            return updated;
          });
        }catch{}
      };
      fetchPrice();
      iv=setInterval(fetchPrice,3000);
    } else {
      iv=setInterval(()=>{
        setCandles(prev=>{
          const last=prev.at(-1);
          const d=(Math.random()-.496)*.0009;
          const np=Math.max(1.04,Math.min(1.17,last.c+d));
          const nc={o:last.c,c:np,h:Math.max(last.c,np)+Math.random()*.0003,l:Math.min(last.c,np)-Math.random()*.0003};
          const updated=[...prev.slice(-79),nc];
          const closes=updated.map(c=>c.c);
          const newBB=calcBB(closes);
          setPrice(np);
          priceRef.current=np;
          setRsi(calcRSI(closes));
          setMacd(calcMACD(closes));
          setBB(newBB);
          bbRef.current=newBB;
          return updated;
        });
      },1500);
    }

    return()=>clearInterval(iv);
  },[symbol]);

  /* ── Binance klines for indicators ──────────────────────────────────── */
  useEffect(()=>{
    const cur=ASSETS[symbol];
    if(cur.type!=="crypto")return;
    const load=async()=>{
      try{
        const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${cur.binance}&interval=1m&limit=80`);
        const d=await r.json();
        if(!Array.isArray(d))return;
        const newCandles=d.map(k=>({o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])}));
        setCandles(newCandles);
        const closes=newCandles.map(c=>c.c);
        const volumes=newCandles.map(c=>c.v);
        const newBB=calcBB(closes);
        const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
        const vt=calcVolumeTrend(volumes);
        const t1h=calcTrend1h(closes);
        const pts=detectPatterns(newCandles);
        setRsi(calcRSI(closes)); setMacd(calcMACD(closes));
        setBB(newBB); bbRef.current=newBB;
        setEma9(e9); ema9Ref.current=e9;
        setEma21(e21); ema21Ref.current=e21;
        setVolTrend(vt); volRef.current=vt;
        setTrend1h(t1h); trend1hRef.current=t1h;
        setPatterns(pts); patternsRef.current=pts;
      }catch{}
    };
    load();
    const iv=setInterval(load,60000);
    return()=>clearInterval(iv);
  },[symbol]);

  /* ── Close position ──────────────────────────────────────────────────── */
  const closePosition=useCallback((posId,currentPrice,reason)=>{
    setPositions(prev=>{
      const pos=prev.find(p=>p.id===posId);
      if(!pos)return prev;
      const pnl=posPnL(pos,currentPrice);
      const prec=ASSETS[symbolRef.current].precision;
      const emoji=reason==="TP"?"✅":reason==="SL"?"🛑":"⬜";
      addLog(`${emoji} ${reason} ${pos.type} @ ${fP(currentPrice,prec)} → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      setBalance(b=>{const nb=b+pnl;balanceRef.current=nb;return nb;});
      setTrades(t=>[{...pos,exit:currentPrice,pnl,reason,time:now(),symbol:symbolRef.current},...t.slice(0,49)]);
      setClosedCount(c=>c+1);
      setTotalProfit(p=>p+pnl);
      if(reason==="TP"&&autoRef.current){
        pendingAnalysisRef.current=true;
        setAutoPhase("tp_hit_analyzing");
      }
      return prev.filter(p=>p.id!==posId);
    });
  },[addLog]);

  /* ── TP / SL watcher ─────────────────────────────────────────────────── */
  useEffect(()=>{
    posRef.current.forEach(pos=>{
      const pnl=posPnL(pos,price);
      if(pnl>=TAKE_PROFIT_USD) closePosition(pos.id,price,"TP");
      else if(pnl<=-STOP_LOSS_USD) closePosition(pos.id,price,"SL");
    });
  },[price,closePosition]);

  /* ── Core analyze ────────────────────────────────────────────────────── */
  const runAnalysis=useCallback(async(reason="Ciclo automático")=>{
    if(analyzing)return;
    setAnalyzing(true);
    setAutoPhase("analyzing");
    addLog(`🔍 Analizando ${symbolRef.current}: ${reason}`,"info");
    try{
      const result=await analyzeMarketAI({
        symbol:symbolRef.current,
        price:priceRef.current,  rsi:rsiRef.current,
        macd:macdRef.current,    bb:bbRef.current,
        ema9:ema9Ref.current,    ema21:ema21Ref.current,
        volRatio:volRef.current.ratio, trend1h:trend1hRef.current,
        patterns:patternsRef.current,
        positions:posRef.current, balance:balanceRef.current,
        news:newsRef.current,    reason,
      });
      setAiResult(result);
      addLog(`📡 ${result.signal} (${result.confidence}%) — ${result.key_factor}`,
        result.signal==="BUY"?"buy":result.signal==="SELL"?"sell":"info");

      if(autoRef.current){
        const slots=MAX_POSITIONS-posRef.current.length;
        if(result.should_open&&result.signal!=="HOLD"&&slots>0&&result.confidence>=60){
          const isBuy=result.signal==="BUY";
          const cp=priceRef.current;
          const prec=ASSETS[symbolRef.current].precision;
          const newPos={type:result.signal,entry:cp,id:Date.now()+Math.random()};
          setPositions(p=>[...p,newPos]);
          addLog(`${isBuy?"🟢 BUY":"🔴 SELL"} @ ${fP(cp,prec)} | TP:+$${TAKE_PROFIT_USD} SL:-$${STOP_LOSS_USD}`,isBuy?"buy":"sell");
          setAutoPhase("monitoring");
        } else {
          const why=!result.should_open?"sin confluencia clara"
            :result.confidence<60?`confianza baja (${result.confidence}%)`
            :slots===0?"slots llenos":"señal HOLD";
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

    addLog("🤖 AUTO ACTIVADO — TP:+$"+TAKE_PROFIT_USD+" | SL:-$"+STOP_LOSS_USD+" | Máx "+MAX_POSITIONS+" pos","info");
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
      if(posRef.current.length<MAX_POSITIONS) runAnalysis("Ciclo automático regular");
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

  /* ── Load news ───────────────────────────────────────────────────────── */
  const loadNews=useCallback(async(sym)=>{
    const target=sym||symbolRef.current;
    setLoadingNews(true);
    addLog(`📰 Obteniendo noticias ${target}...`,"info");
    try{
      const d=await fetchNewsAI(target);
      setNewsData(d); setNews(d.headlines||[]);
      addLog(`📰 ${d.headlines?.length||0} noticias — Sesgo: ${(d.market_bias||"neutral").toUpperCase()}`,"info");
    }catch{addLog("❌ Error al cargar noticias","sell");}
    setLoadingNews(false);
  },[addLog]);

  useEffect(()=>{loadNews(symbol);},[symbol]);

  /* ── Manual close ────────────────────────────────────────────────────── */
  const manualClose=useCallback((id)=>{
    closePosition(id,priceRef.current,"MANUAL");
  },[closePosition]);

  /* ── Stats ───────────────────────────────────────────────────────────── */
  const unrealized=positions.reduce((s,p)=>s+posPnL(p,price),0);
  const winCount=trades.filter(t=>t.pnl>0).length;
  const winRate=trades.length?Math.round(winCount/trades.length*100):0;
  const sigCol=aiResult?.signal==="BUY"?T.green:aiResult?.signal==="SELL"?T.red:T.yellow;
  const nextSec=nextAnalysis?Math.max(0,Math.round(nextAnalysis/1000)):null;

  const phaseInfo={
    idle:              {label:"INACTIVO",             color:T.muted,  desc:"Activa el modo AUTO para comenzar."},
    analyzing:         {label:"⏳ ANALIZANDO",         color:T.yellow, desc:"Consultando IA con indicadores y noticias en tiempo real..."},
    monitoring:        {label:"📡 MONITOREANDO",       color:T.accent, desc:`Vigilando ${positions.length} posición(es). TP:+$${TAKE_PROFIT_USD} | SL:-$${STOP_LOSS_USD}`},
    waiting_conditions:{label:"⏸ ESPERANDO",          color:T.orange, desc:`Sin condiciones favorables. Próximo análisis en ${nextSec??"-"}s`},
    tp_hit_analyzing:  {label:"✅ TP! RE-ANALIZANDO",  color:T.green,  desc:"Posición cerrada con ganancia. Evaluando si abrir nueva..."},
  }[autoPhase]||{label:"—",color:T.muted,desc:""};

  return(
    <>
      <style>{STYLES}</style>
      <div className="scanlines"/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",padding:"14px 16px",maxWidth:940,margin:"0 auto"}}>

        {/* HEADER */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:9,color:T.muted,letterSpacing:4,textTransform:"uppercase",marginBottom:6}}>Robot Autónomo de Trading</div>
            {/* PAIR SELECTOR */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {Object.keys(ASSETS).map(s=>(
                <button key={s} onClick={()=>handleSymbolChange(s)}
                  style={{
                    background:symbol===s?`${T.accent}20`:"transparent",
                    border:`1px solid ${symbol===s?T.accent:T.border}`,
                    color:symbol===s?T.accent:T.muted,
                    borderRadius:6, padding:"5px 14px", cursor:"pointer",
                    fontSize:12, fontWeight:symbol===s?700:400, letterSpacing:.5,
                  }}>
                  {ASSETS[s].type==="crypto"?"◈":"€"} {s}
                </button>
              ))}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginBottom:2}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:T.green,display:"inline-block",animation:"pulse 1.4s ease-in-out infinite"}}/>
              <span style={{color:T.green}}>{asset.type==="crypto"?"EN VIVO • BINANCE":"SIMULADO"}</span>
            </div>
            <div className="mono" style={{fontSize:26,fontWeight:700,color:T.accent}}>{fP(price,asset.precision)}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:1}}>{symbol} · Paper Trading</div>
          </div>
        </div>

        {/* NEWS TICKER */}
        {news.length>0&&<div style={{marginBottom:10}}><Ticker headlines={news}/></div>}

        {/* STATS ROW */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:7,marginBottom:10}}>
          {[
            {l:"BALANCE",    v:`$${balance.toFixed(0)}`,  c:T.accent},
            {l:"NO REALIZ",  v:fUSD(unrealized),           c:unrealized>=0?T.green:T.red},
            {l:"P&L ACUM",   v:fUSD(totalProfit),          c:totalProfit>=0?T.green:T.red},
            {l:"CERRADAS",   v:closedCount,                c:T.yellow},
            {l:"WIN RATE",   v:`${winRate}%`,              c:winRate>=50?T.green:T.red},
            {l:"POSICIONES", v:`${positions.length}/${MAX_POSITIONS}`, c:T.text},
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

        {/* CHART — TradingView */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>GRÁFICA EN VIVO • TRADINGVIEW • {symbol}</span>
            <span style={{fontSize:8,color:T.accent}}>Intervalo 5m</span>
          </div>
          <TradingViewChart tvSymbol={asset.tvSymbol}/>
        </div>

        {/* POSITIONS */}
        {positions.length>0&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:6}}>POSICIONES ABIERTAS — TP +${TAKE_PROFIT_USD} | SL -${STOP_LOSS_USD}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {positions.map(pos=><PosRow key={pos.id} pos={pos} price={price} precision={asset.precision} onClose={()=>manualClose(pos.id)}/>)}
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
                const pnl=pos?posPnL(pos,price):null;
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
            {!autoMode&&aiResult.signal!=="HOLD"&&positions.length<MAX_POSITIONS&&(
              <button onClick={()=>{
                const pos={type:aiResult.signal,entry:priceRef.current,id:Date.now()};
                setPositions(p=>[...p,pos]);
                addLog(`${aiResult.signal==="BUY"?"🟢":"🔴"} ${aiResult.signal} manual @ ${fP(priceRef.current,asset.precision)}`,aiResult.signal==="BUY"?"buy":"sell");
              }} style={{marginTop:10,width:"100%",background:`${sigCol}18`,border:`1px solid ${sigCol}`,
                color:sigCol,borderRadius:7,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,letterSpacing:1}}>
                ▶ EJECUTAR {aiResult.signal} MANUALMENTE (pos {positions.length+1}/{MAX_POSITIONS})
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

        {/* PATTERNS PANEL */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>PATRONES CHARTISTAS DETECTADOS · {symbol}</span>
            <span style={{fontSize:8,color:T.muted}}>últimas 60 velas</span>
          </div>
          {patterns.length===0?(
            <div style={{fontSize:10,color:T.muted,fontStyle:"italic"}}>Sin patrones claros detectados en este momento.</div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {patterns.map((p,i)=>{
                const col=p.signal==="BULLISH"?T.green:p.signal==="BEARISH"?T.red:T.yellow;
                return(
                  <div key={i} style={{background:`${col}12`,border:`1px solid ${col}40`,borderRadius:6,padding:"6px 12px",display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:14,color:col}}>{p.emoji}</span>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:col}}>{p.name}</div>
                      <div style={{fontSize:8,color:T.muted}}>
                        {p.type} · {p.signal} · {p.conf}% confianza
                      </div>
                    </div>
                  </div>
                );
              })}
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
          ⚠️ MODO PAPER TRADING — Dinero 100% simulado · Precios crypto en vivo vía Binance · Gráficas via TradingView · TP +$1.20 · SL -$2.00<br/>
          Las señales son educativas y no garantizan resultados en mercados reales. Opera siempre con responsabilidad.
        </div>

      </div>
    </>
  );
}
