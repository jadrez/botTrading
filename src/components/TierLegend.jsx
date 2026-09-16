import { T } from "../theme.js";
import { SYMBOL_STRATEGY } from "../lib/symbolStrategy.js";
import { SIM_CONFIDENCE_DISCOUNT, SIM_CONFIDENCE_FLOOR } from "../lib/constants.js";

// SYMBOL_STRATEGY gets mutated in place once /api/symbol-strategy resolves
// (see the effect in trading-bot-v3.jsx), so this recomputes the real MIXTO
// range from whatever's live instead of hardcoding a number that goes stale
// the moment the walk-forward re-validation or the Simulado discount changes.
function mixtoConfRange(){
  const confs=Object.values(SYMBOL_STRATEGY).filter(s=>s.tier==="MIXTO"&&s.minConf!=null).map(s=>s.minConf);
  if(!confs.length) return {realTxt:"70-80",simTxt:"55-65"};
  const lo=Math.min(...confs), hi=Math.max(...confs);
  const simLo=Math.max(SIM_CONFIDENCE_FLOOR,lo-SIM_CONFIDENCE_DISCOUNT);
  const simHi=Math.max(SIM_CONFIDENCE_FLOOR,hi-SIM_CONFIDENCE_DISCOUNT);
  const fmt=(a,b)=>a===b?`${a}`:`${a}-${b}`;
  return {realTxt:fmt(lo,hi), simTxt:fmt(simLo,simHi)};
}

export default function TierLegend(){
  const {realTxt,simTxt}=mixtoConfRange();
  const TIERS=[
    {tier:"ROBUSTO", col:T.green, desc:"Ventaja sostenida en ≥3/4 folds de validación — auto-trading activo con el TP/SL óptimo encontrado."},
    {tier:"MIXTO",   col:T.yellow, desc:`Resultado inconsistente entre folds — umbral elevado en Deriv Real (≥${realTxt}%); en Simulado baja a ≥${simTxt}% para aprender más rápido.`},
    {tier:"SIN-EDGE",col:T.red,  desc:"0/4 folds rentables — auto-trading desactivado 🔒. Se sigue mostrando la señal para trading manual."},
  ];
  return(
    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:10}}>VALIDACIÓN POR SÍMBOLO · WALK-FORWARD</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {TIERS.map(({tier,col,desc})=>(
          <div key={tier} style={{display:"flex",gap:8,alignItems:"flex-start",background:T.card,border:`1px solid ${col}35`,borderRadius:7,padding:"8px 10px"}}>
            <span style={{fontSize:6,fontWeight:700,color:col,background:`${col}18`,padding:"2px 6px",borderRadius:3,letterSpacing:.5,whiteSpace:"nowrap",marginTop:1}}>{tier}</span>
            <span style={{fontSize:8,color:T.muted,lineHeight:1.5}}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
