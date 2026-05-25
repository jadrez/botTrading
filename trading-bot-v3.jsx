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

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
const TAKE_PROFIT_USD = 2.20;
const STOP_LOSS_USD   = 5.00;
const MAX_POSITIONS   = 5;
const UNITS           = 1000;
const ANALYSIS_INTERVAL_MS = 28000; // 28s entre ciclos auto

/* ─── UTILS ─────────────────────────────────────────────────────────────── */
const f5   = n => n.toFixed(5);
const fUSD = (n, sign=true) => (sign&&n>=0?"+":"")+`$${Math.abs(n).toFixed(2)}`;
const pip  = (a,b) => Math.round((a-b)*100000);
const now  = () => new Date().toLocaleTimeString("es");

function genCandles(base=1.0823, n=80) {
  const arr=[]; let p=base;
  for(let i=0;i<n;i++){
    const d=(Math.random()-.496)*.0022;
    const o=p, c=Math.max(1.03,Math.min(1.18,p+d));
    arr.push({o,c,h:Math.max(o,c)+Math.random()*.0005,l:Math.min(o,c)-Math.random()*.0005});
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
  if(closes.length<p)return{upper:closes.at(-1)+.003,mid:closes.at(-1),lower:closes.at(-1)-.003};
  const sl=closes.slice(-p),mid=sl.reduce((a,b)=>a+b,0)/p;
  const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mid)**2,0)/p);
  return{upper:mid+2*std,mid,lower:mid-2*std};
}

function posPnL(pos, price){
  return (price - pos.entry) * pos.units * (pos.type==="BUY"?1:-1);
}

/* ─── CHART ─────────────────────────────────────────────────────────────── */
function CandleChart({candles, positions, price}){
  const W=700,H=175;
  if(!candles.length)return null;
  const ps=candles.flatMap(c=>[c.h,c.l]);
  const mn=Math.min(...ps),mx=Math.max(...ps);
  const sy=v=>H-((v-mn)/(mx-mn||1))*H*.9-H*.05;
  const cw=W/candles.length;
  const bb=calcBB(candles.map(c=>c.c));
  const tpLines=positions.map(p=>({
    y:sy(p.type==="BUY"?p.entry+TAKE_PROFIT_USD/UNITS:p.entry-TAKE_PROFIT_USD/UNITS),
    col:T.green,
  }));
  const slLines=positions.map(p=>({
    y:sy(p.type==="BUY"?p.entry-STOP_LOSS_USD/UNITS:p.entry+STOP_LOSS_USD/UNITS),
    col:T.red,
  }));

  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}}>
      <defs>
        <linearGradient id="bbfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.accent} stopOpacity=".07"/>
          <stop offset="100%" stopColor={T.accent} stopOpacity=".01"/>
        </linearGradient>
      </defs>
      {[.2,.4,.6,.8].map(p=>(
        <line key={p} x1="0" y1={H*p} x2={W} y2={H*p} stroke={T.border} strokeWidth=".5" strokeDasharray="3,6"/>
      ))}
      <polygon points={`0,${sy(bb.upper)} ${W},${sy(bb.upper)} ${W},${sy(bb.lower)} 0,${sy(bb.lower)}`} fill="url(#bbfill)"/>
      <line x1="0" y1={sy(bb.upper)} x2={W} y2={sy(bb.upper)} stroke={T.accent} strokeWidth=".7" opacity=".35" strokeDasharray="4,5"/>
      <line x1="0" y1={sy(bb.mid)}   x2={W} y2={sy(bb.mid)}   stroke={T.accent} strokeWidth=".9" opacity=".2"/>
      <line x1="0" y1={sy(bb.lower)} x2={W} y2={sy(bb.lower)} stroke={T.accent} strokeWidth=".7" opacity=".35" strokeDasharray="4,5"/>
      {candles.map((c,i)=>{
        const x=i*cw+cw/2,up=c.c>=c.o,col=up?T.green:T.red;
        const bT=sy(Math.max(c.o,c.c)),bB=sy(Math.min(c.o,c.c));
        return(
          <g key={i}>
            <line x1={x} y1={sy(c.h)} x2={x} y2={sy(c.l)} stroke={col} strokeWidth=".8" opacity=".65"/>
            <rect x={x-cw*.38} y={bT} width={cw*.76} height={Math.max(bB-bT,1)} fill={col} opacity=".85" rx=".5"/>
          </g>
        );
      })}
      {/* Entry lines */}
      {positions.map((p,i)=>(
        <line key={`e${i}`} x1="0" y1={sy(p.entry)} x2={W} y2={sy(p.entry)}
          stroke={p.type==="BUY"?T.green:T.red} strokeWidth="1" strokeDasharray="5,4" opacity=".6"/>
      ))}
      {/* TP lines */}
      {tpLines.map((l,i)=>(
        <line key={`tp${i}`} x1="0" y1={l.y} x2={W} y2={l.y} stroke={T.green} strokeWidth=".6" strokeDasharray="2,6" opacity=".4"/>
      ))}
      {/* SL lines */}
      {slLines.map((l,i)=>(
        <line key={`sl${i}`} x1="0" y1={l.y} x2={W} y2={l.y} stroke={T.red} strokeWidth=".6" strokeDasharray="2,6" opacity=".4"/>
      ))}
      {/* Current price line */}
      <line x1="0" y1={sy(price)} x2={W} y2={sy(price)} stroke={T.yellow} strokeWidth=".8" opacity=".5"/>
      <rect x={W-42} y={sy(price)-7} width={42} height={13} fill={T.yellow} opacity=".15" rx="2"/>
      <text x={W-3} y={sy(price)+4} textAnchor="end" fill={T.yellow} fontSize="7" fontFamily="IBM Plex Mono">{f5(price)}</text>
    </svg>
  );
}

/* ─── POSITION ROW ───────────────────────────────────────────────────────── */
function PosRow({pos, price, onClose}){
  const pnl=posPnL(pos,price);
  const col=pnl>=0?T.green:T.red;
  const pct=Math.min(100,Math.max(0,(pnl/TAKE_PROFIT_USD)*100));
  const isBuy=pos.type==="BUY";
  return(
    <div className="fade-up" style={{background:T.card,border:`1px solid ${col}30`,borderRadius:6,padding:"8px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,fontWeight:700,color:col,background:`${col}18`,padding:"2px 8px",borderRadius:4,letterSpacing:1}}>
            {isBuy?"▲ BUY":"▼ SELL"}
          </span>
          <span className="mono" style={{fontSize:10,color:T.muted}}>@ {f5(pos.entry)}</span>
          <span className="mono" style={{fontSize:10,color:T.muted}}>
            {pip(isBuy?price:pos.entry, isBuy?pos.entry:price)>0?"+":""}{pip(isBuy?price:pos.entry,isBuy?pos.entry:price)} pip
          </span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span className="mono" style={{fontSize:14,fontWeight:700,color:col}}>{fUSD(pnl)}</span>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${T.muted}40`,color:T.muted,borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10}}>✕</button>
        </div>
      </div>
      {/* Progress bar toward TP */}
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
  return(
    <div style={{overflow:"hidden",background:T.dim,borderRadius:4,padding:"5px 0"}}>
      <div style={{display:"inline-flex",gap:48,whiteSpace:"nowrap",animation:"ticker 50s linear infinite"}}>
        {d.map((h,i)=>(
          <span key={i} style={{fontSize:10,color:h.sentiment==="bullish"?T.green:h.sentiment==="bearish"?T.red:T.muted}}>
            {h.sentiment==="bullish"?"▲":h.sentiment==="bearish"?"▼":"◆"} {h.title}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── AI CALLS ───────────────────────────────────────────────────────────── */
async function fetchNewsAI(){
  const prompt=`Busca en internet las noticias más recientes de hoy que afecten al par EUR/USD en el mercado Forex. Considera: datos macroeconómicos USA/Eurozona, declaraciones BCE/Fed, inflación, empleo, PIB, geopolítica.

Responde SOLO con JSON sin backticks:
{"headlines":[{"title":"titular breve español","sentiment":"bullish"|"bearish"|"neutral","impact":"ALTO"|"MEDIO"|"BAJO"}],"market_bias":"bullish"|"bearish"|"neutral","summary":"resumen 40 palabras"}`;

  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:700,
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}]
    })
  });
  const d=await r.json();
  const txt=(d.content||[]).map(b=>b.text||"").join("");
  try{return JSON.parse(txt.replace(/```json|```/g,"").trim());}
  catch{return{headlines:[],market_bias:"neutral",summary:"Sin noticias disponibles."};}
}

async function analyzeMarketAI({price,rsi,macd,bb,positions,balance,news,reason}){
  const nc=news.slice(0,5).map(n=>`[${n.sentiment.toUpperCase()}|${n.impact}] ${n.title}`).join("\n")||"Sin noticias recientes.";
  const pc=positions.length
    ?positions.map((p,i)=>`  #${i+1} ${p.type} @ ${f5(p.entry)} PnL:${fUSD(posPnL(p,price))}`).join("\n")
    :"  Ninguna";

  const prompt=`Eres un trader Forex experto en EUR/USD. Analiza y decide si abrir UNA nueva posición.

CONTEXTO DEL ANÁLISIS: ${reason}

MERCADO ACTUAL:
Precio EUR/USD: ${f5(price)}
RSI(14): ${rsi.toFixed(2)} ${rsi<30?"→ SOBREVENTA":rsi>70?"→ SOBRECOMPRA":"→ NEUTRAL"}
MACD histograma: ${macd.hist.toFixed(6)} ${macd.hist>0?"→ MOMENTUM ALCISTA":"→ MOMENTUM BAJISTA"}
Bollinger: Superior ${f5(bb.upper)} | Media ${f5(bb.mid)} | Inferior ${f5(bb.lower)}
Precio vs BB: ${price>bb.upper?"SOBRE BANDA SUPERIOR — posible reversión bajista":price<bb.lower?"BAJO BANDA INFERIOR — posible reversión alcista":"DENTRO DE BANDAS"}

NOTICIAS EN VIVO:
${nc}

PORTAFOLIO ($${balance.toFixed(2)} balance):
Posiciones abiertas (${positions.length}/${MAX_POSITIONS}):
${pc}
Slots disponibles: ${MAX_POSITIONS-positions.length}

REGLAS DEL SISTEMA:
- Cada posición se cierra automáticamente en +$${TAKE_PROFIT_USD} (TP) o -$${STOP_LOSS_USD} (SL)
- Máximo ${MAX_POSITIONS} posiciones simultáneas
- Slots disponibles: ${MAX_POSITIONS-positions.length}
- Si las posiciones abiertas ya cubren la dirección del mercado, evita duplicar innecesariamente
- Si no hay confluencia clara entre indicadores y noticias → HOLD

Responde SOLO con JSON sin backticks:
{
  "signal": "BUY"|"SELL"|"HOLD",
  "confidence": 0-100,
  "reasoning": "análisis en español máx 80 palabras explicando por qué",
  "news_impact": "BULLISH"|"BEARISH"|"NEUTRAL",
  "key_factor": "factor decisivo en 5 palabras",
  "risk": "BAJO"|"MEDIO"|"ALTO",
  "should_open": true|false
}`;

  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}]
    })
  });
  const d=await r.json();
  const txt=(d.content||[]).map(b=>b.text||"").join("");
  try{return JSON.parse(txt.replace(/```json|```/g,"").trim());}
  catch{return{signal:"HOLD",confidence:40,reasoning:"Error al parsear respuesta.",news_impact:"NEUTRAL",key_factor:"Error conexión",risk:"ALTO",should_open:false};}
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════════════════════════════ */
export default function TradingBot(){
  const [candles,setCandles]     = useState(()=>genCandles(1.0823,80));
  const [price,setPrice]         = useState(1.0823);
  const [rsi,setRsi]             = useState(50);
  const [macd,setMacd]           = useState({macd:0,signal:0,hist:0});
  const [bb,setBB]               = useState({upper:1.085,mid:1.082,lower:1.079});
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
  // Auto state machine
  const [autoPhase,setAutoPhase] = useState("idle");
  // "idle" | "analyzing" | "waiting_conditions" | "monitoring" | "tp_hit_analyzing"
  const [nextAnalysis,setNextAnalysis] = useState(null); // countdown ms
  const [closedCount,setClosedCount]   = useState(0);
  const [totalProfit,setTotalProfit]   = useState(0);

  // Refs for closures
  const posRef    = useRef([]);
  const priceRef  = useRef(1.0823);
  const autoRef   = useRef(false);
  const rsiRef    = useRef(50);
  const macdRef   = useRef({macd:0,signal:0,hist:0});
  const bbRef     = useRef({upper:1.085,mid:1.082,lower:1.079});
  const newsRef   = useRef([]);
  const balanceRef= useRef(10000);
  const timerRef  = useRef(null);
  const countRef  = useRef(null);
  const pendingAnalysisRef = useRef(false);

  useEffect(()=>{posRef.current=positions;},[positions]);
  useEffect(()=>{priceRef.current=price;},[price]);
  useEffect(()=>{autoRef.current=autoMode;},[autoMode]);
  useEffect(()=>{rsiRef.current=rsi;},[rsi]);
  useEffect(()=>{macdRef.current=macd;},[macd]);
  useEffect(()=>{bbRef.current=bb;},[bb]);
  useEffect(()=>{newsRef.current=news;},[news]);
  useEffect(()=>{balanceRef.current=balance;},[balance]);

  const addLog=useCallback((msg,type="info")=>{
    setLog(p=>[{msg,type,time:now()},...p.slice(0,99)]);
  },[]);

  /* ── Tick ─────────────────────────────────────────────────────────────── */
  useEffect(()=>{
    const iv=setInterval(()=>{
      setCandles(prev=>{
        const last=prev.at(-1);
        const d=(Math.random()-.496)*.0009;
        const np=Math.max(1.04,Math.min(1.17,last.c+d));
        const nc={o:last.c,c:np,h:Math.max(last.c,np)+Math.random()*.0003,l:Math.min(last.c,np)-Math.random()*.0003};
        const updated=[...prev.slice(-79),nc];
        const closes=updated.map(c=>c.c);
        setPrice(np); setRsi(calcRSI(closes));
        setMacd(calcMACD(closes)); setBB(calcBB(closes));
        return updated;
      });
    },1500);
    return()=>clearInterval(iv);
  },[]);

  /* ── Close position (internal) ───────────────────────────────────────── */
  const closePosition=useCallback((posId, currentPrice, reason)=>{
    setPositions(prev=>{
      const pos=prev.find(p=>p.id===posId);
      if(!pos)return prev;
      const pnl=posPnL(pos,currentPrice);
      const emoji=reason==="TP"?"✅":reason==="SL"?"🛑":"⬜";
      addLog(`${emoji} ${reason} ${pos.type} @ ${f5(currentPrice)} → ${fUSD(pnl)}`,pnl>=0?"buy":"sell");
      setBalance(b=>{const nb=b+pnl;balanceRef.current=nb;return nb;});
      setTrades(t=>[{...pos,exit:currentPrice,pnl,reason,time:now()},...t.slice(0,49)]);
      setClosedCount(c=>c+1);
      setTotalProfit(p=>p+pnl);
      // If TP hit and auto mode → trigger post-close analysis
      if(reason==="TP" && autoRef.current){
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

  /* ── Core analyze function ───────────────────────────────────────────── */
  const runAnalysis=useCallback(async(reason="Ciclo automático")=>{
    if(analyzing)return;
    setAnalyzing(true);
    setAutoPhase("analyzing");
    addLog(`🔍 Analizando: ${reason}`,  "info");
    try{
      const result=await analyzeMarketAI({
        price:priceRef.current, rsi:rsiRef.current,
        macd:macdRef.current,   bb:bbRef.current,
        positions:posRef.current, balance:balanceRef.current,
        news:newsRef.current, reason,
      });
      setAiResult(result);
      addLog(`📡 ${result.signal} (${result.confidence}%) — ${result.key_factor}`,
        result.signal==="BUY"?"buy":result.signal==="SELL"?"sell":"info");

      if(autoRef.current){
        const slots=MAX_POSITIONS-posRef.current.length;
        if(result.should_open && result.signal!=="HOLD" && slots>0 && result.confidence>=60){
          // Open one position
          const isBuy=result.signal==="BUY";
          const cp=priceRef.current;
          const newPos={
            type:result.signal, entry:cp, units:UNITS,
            id:Date.now()+Math.random(),
          };
          setPositions(p=>[...p,newPos]);
          addLog(`${isBuy?"🟢 BUY":"🔴 SELL"} abierta @ ${f5(cp)} | TP:+$${TAKE_PROFIT_USD} SL:-$${STOP_LOSS_USD}`,
            isBuy?"buy":"sell");
          setAutoPhase("monitoring");
        } else {
          // Conditions not met
          const why=!result.should_open?"sin confluencia clara"
            :result.confidence<60?`confianza baja (${result.confidence}%)`
            :slots===0?"slots llenos":"señal HOLD";
          addLog(`⏸ Sin abrir posición — ${why}. Esperando siguiente ciclo.`,"info");
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
    // immediate first analysis
    runAnalysis("Inicio modo automático");

    let remaining=ANALYSIS_INTERVAL_MS;
    countRef.current=setInterval(()=>{
      remaining-=1000;
      setNextAnalysis(remaining);
      if(remaining<=0) remaining=ANALYSIS_INTERVAL_MS;
    },1000);

    timerRef.current=setInterval(()=>{
      remaining=ANALYSIS_INTERVAL_MS;
      if(!autoRef.current)return;
      // Only run if slots available and not currently analyzing
      if(posRef.current.length<MAX_POSITIONS){
        runAnalysis("Ciclo automático regular");
      } else {
        setAutoPhase("monitoring");
      }
    },ANALYSIS_INTERVAL_MS);

    return()=>{clearInterval(timerRef.current);clearInterval(countRef.current);};
  },[autoMode]);

  /* ── React to TP hit → re-analyze ───────────────────────────────────── */
  useEffect(()=>{
    if(!pendingAnalysisRef.current||analyzing)return;
    if(autoRef.current && posRef.current.length<MAX_POSITIONS){
      setTimeout(()=>{
        if(autoRef.current)
          runAnalysis("Re-análisis post cierre TP — evaluando nueva entrada");
      },1500);
    }
  },[positions,analyzing,runAnalysis]);

  /* ── Load news ───────────────────────────────────────────────────────── */
  const loadNews=useCallback(async()=>{
    setLoadingNews(true);
    addLog("📰 Obteniendo noticias EUR/USD...","info");
    try{
      const d=await fetchNewsAI();
      setNewsData(d); setNews(d.headlines||[]);
      addLog(`📰 ${d.headlines?.length||0} noticias — Sesgo: ${(d.market_bias||"neutral").toUpperCase()}`,"info");
    }catch{addLog("❌ Error al cargar noticias","sell");}
    setLoadingNews(false);
  },[addLog]);

  useEffect(()=>{loadNews();},[]);

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
    idle:           {label:"INACTIVO",            color:T.muted,  desc:"Activa el modo AUTO para comenzar."},
    analyzing:      {label:"⏳ ANALIZANDO",        color:T.yellow, desc:"Consultando IA con indicadores y noticias en tiempo real..."},
    monitoring:     {label:"📡 MONITOREANDO",      color:T.accent, desc:`Vigilando ${positions.length} posición(es). TP:+$${TAKE_PROFIT_USD} | SL:-$${STOP_LOSS_USD}`},
    waiting_conditions:{label:"⏸ ESPERANDO",      color:T.orange, desc:`Sin condiciones favorables. Próximo análisis en ${nextSec??"-"}s`},
    tp_hit_analyzing:{label:"✅ TP! RE-ANALIZANDO",color:T.green,  desc:"Posición cerrada con ganancia. Evaluando si abrir nueva..."},
  }[autoPhase]||{label:"—",color:T.muted,desc:""};

  return(
    <>
      <style>{STYLES}</style>
      <div className="scanlines"/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",padding:"14px 16px",maxWidth:940,margin:"0 auto"}}>

        {/* HEADER */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:9,color:T.muted,letterSpacing:4,textTransform:"uppercase",marginBottom:1}}>Robot Autónomo Forex</div>
            <div style={{fontSize:24,fontWeight:900,letterSpacing:.5}}>
              EUR<span style={{color:T.accent}}>/</span>USD
              <span style={{fontSize:11,fontWeight:300,color:T.muted,marginLeft:8}}>Paper Trading</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:T.green,display:"inline-block",animation:"pulse 1.4s ease-in-out infinite"}}/>
              <span style={{color:T.green}}>EN VIVO SIMULADO</span>
            </div>
            <div className="mono" style={{fontSize:24,fontWeight:700,color:T.accent,marginTop:2}}>{f5(price)}</div>
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
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:10}}>
          {[
            {l:"RSI (14)",  v:rsi.toFixed(1),        c:rsi<30?T.green:rsi>70?T.red:T.yellow, s:rsi<30?"SOBREVENTA":rsi>70?"SOBRECOMPRA":"NEUTRAL"},
            {l:"MACD HIST", v:macd.hist.toFixed(5),  c:macd.hist>0?T.green:T.red,             s:macd.hist>0?"ALCISTA":"BAJISTA"},
            {l:"BB UPPER",  v:f5(bb.upper),           c:price>bb.upper?T.red:T.muted,          s:price>bb.upper?"⚠ SOBRE BANDA":"normal"},
            {l:"BB LOWER",  v:f5(bb.lower),           c:price<bb.lower?T.green:T.muted,        s:price<bb.lower?"⚠ BAJO BANDA":"normal"},
          ].map(({l,v,c,s})=>(
            <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 12px"}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:2}}>{l}</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
              <div style={{fontSize:8,color:c,marginTop:2,opacity:.75}}>{s}</div>
            </div>
          ))}
        </div>

        {/* CHART */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>GRÁFICA VELAS • BB • NIVELES TP/SL</span>
            <div style={{display:"flex",gap:12,fontSize:8}}>
              <span style={{color:T.green}}>— entrada / TP</span>
              <span style={{color:T.red}}>— SL</span>
              <span style={{color:T.yellow}}>— precio actual</span>
            </div>
          </div>
          <CandleChart candles={candles} positions={positions} price={price}/>
        </div>

        {/* POSITIONS */}
        {positions.length>0&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:6}}>POSICIONES ABIERTAS — TP +${TAKE_PROFIT_USD} | SL -${STOP_LOSS_USD}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {positions.map(pos=><PosRow key={pos.id} pos={pos} price={price} onClose={()=>manualClose(pos.id)}/>)}
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
            {/* Slot indicators */}
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
                <div style={{fontSize:8,color:T.muted,letterSpacing:3,marginBottom:3}}>ÚLTIMO ANÁLISIS IA</div>
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
            {/* Manual execute button */}
            {!autoMode&&aiResult.signal!=="HOLD"&&positions.length<MAX_POSITIONS&&(
              <button onClick={()=>{
                const pos={type:aiResult.signal,entry:priceRef.current,units:UNITS,id:Date.now()};
                setPositions(p=>[...p,pos]);
                addLog(`${aiResult.signal==="BUY"?"🟢":"🔴"} ${aiResult.signal} manual @ ${f5(priceRef.current)}`,aiResult.signal==="BUY"?"buy":"sell");
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
          <button onClick={loadNews} disabled={loadingNews}
            style={{background:loadingNews?T.dim:`${T.yellow}10`,border:`1px solid ${loadingNews?T.border:T.yellow}`,
              color:loadingNews?T.muted:T.yellow,borderRadius:8,padding:"11px 8px",cursor:loadingNews?"not-allowed":"pointer",fontSize:12,fontWeight:700}}>
            {loadingNews?"⏳ Cargando...":"📰 Actualizar Noticias"}
          </button>
        </div>

        {/* NEWS PANEL */}
        {newsData&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
              <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>NOTICIAS EN VIVO</span>
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
              {trades.slice(0,10).map((t,i)=>(
                <div key={i} style={{display:"flex",gap:8,fontSize:9,padding:"3px 0",borderBottom:`1px solid ${T.border}25`,alignItems:"center"}}>
                  <span style={{color:t.type==="BUY"?T.green:T.red,minWidth:28,fontWeight:700}}>{t.type}</span>
                  <span className="mono" style={{color:T.muted}}>{f5(t.entry)}→{f5(t.exit)}</span>
                  <span style={{fontSize:8,color:t.reason==="TP"?T.green:t.reason==="SL"?T.red:T.muted,
                    background:`${t.reason==="TP"?T.green:t.reason==="SL"?T.red:T.muted}15`,
                    padding:"1px 5px",borderRadius:3}}>{t.reason}</span>
                  <span className="mono" style={{color:t.pnl>=0?T.green:T.red,marginLeft:"auto",fontWeight:700}}>{fUSD(t.pnl)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DISCLAIMER */}
        <div style={{fontSize:8,color:T.muted,textAlign:"center",lineHeight:1.9,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
          ⚠️ MODO PAPER TRADING — Dinero 100% simulado · Noticias en tiempo real vía búsqueda web · TP +$1.20 · SL -$2.00<br/>
          Las señales son educativas y no garantizan resultados en mercados reales. Opera siempre con responsabilidad.
        </div>

      </div>
    </>
  );
}
