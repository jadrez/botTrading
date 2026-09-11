import { T } from "../theme.js";

const fP = (n, p) => Number(n).toFixed(p);

export default function TechnicalPanel({symbol, price, rsi, macd, bb, ema9, ema21, volTrend, trend1h, precision}){
  const emaCross=ema9>ema21?"ALCISTA":"BAJISTA";
  const emaCrossCol=ema9>ema21?T.green:T.red;
  const volLabel=volTrend.ratio>1.5?"ALTO":volTrend.ratio<0.7?"BAJO":"NORMAL";
  const volCol=volTrend.ratio>1.5?T.green:volTrend.ratio<0.7?T.muted:T.yellow;
  const trend1hCol=trend1h>0?T.green:T.red;
  const indicators=[
    {l:"RSI (14)",     v:rsi.toFixed(1),        c:rsi<30?T.green:rsi>70?T.red:T.yellow, s:rsi<30?"SOBREVENTA":rsi>70?"SOBRECOMPRA":"NEUTRAL"},
    {l:"MACD HIST",    v:macd.hist.toFixed(precision>3?5:2), c:macd.hist>0?T.green:T.red, s:macd.hist>0?"ALCISTA":"BAJISTA"},
    {l:"BB UPPER",     v:fP(bb.upper,precision), c:price>bb.upper?T.red:T.muted, s:price>bb.upper?"⚠ SOBRE BANDA":"normal"},
    {l:"BB LOWER",     v:fP(bb.lower,precision), c:price<bb.lower?T.green:T.muted, s:price<bb.lower?"⚠ BAJO BANDA":"normal"},
    {l:"EMA 9/21",     v:`${fP(ema9,precision>3?4:1)}`, c:emaCrossCol, s:`CRUCE ${emaCross}`},
    {l:"VOLUMEN",      v:`×${volTrend.ratio.toFixed(2)}`, c:volCol, s:`${volLabel} vs promedio`},
    {l:"TENDENCIA 1H", v:`${trend1h>=0?"+":""}${trend1h.toFixed(3)}%`, c:trend1hCol, s:trend1h>0?"ALCISTA 1H":"BAJISTA 1H"},
    {l:"EMA SEÑAL",    v:ema9>ema21?"BUY":"SELL", c:emaCrossCol, s:ema9>ema21?"EMA9 > EMA21":"EMA9 < EMA21"},
  ];
  return(
    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:10}}>ANÁLISIS TÉCNICO &nbsp;·&nbsp; {symbol}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
        {indicators.map(({l,v,c,s})=>(
          <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 12px"}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:2}}>{l}</div>
            <div className="mono" style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
            <div style={{fontSize:8,color:c,marginTop:2,opacity:.75}}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
