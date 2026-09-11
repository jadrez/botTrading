import { T } from "../theme.js";

const TIERS=[
  {tier:"ROBUSTO", col:T.green, desc:"Ventaja sostenida en ≥3/4 folds de validación — auto-trading activo con el TP/SL óptimo encontrado."},
  {tier:"MIXTO",   col:T.yellow, desc:"Resultado inconsistente entre folds — auto-trading activo pero con umbral de confianza elevado (≥80%)."},
  {tier:"SIN-EDGE",col:T.red,  desc:"0/4 folds rentables — auto-trading desactivado 🔒. Se sigue mostrando la señal para trading manual."},
];

export default function TierLegend(){
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
