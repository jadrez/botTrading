import { T } from "../theme.js";
import { DEFAULT_STAKE } from "../lib/constants.js";

export default function CapitalPanel({
  initialCapital, setInitialCapital,
  positionSize, setPositionSize,
  stakeAutoScale, setStakeAutoScale,
  stakeStep, setStakeStep,
  stakeGrowthTrigger, setStakeGrowthTrigger,
  minStake, setMinStake,
}){
  return(
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:8}}>GESTIÓN DE CAPITAL</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:stakeAutoScale?8:0}}>
        <label style={{display:"flex",flexDirection:"column",gap:3}}>
          <span style={{fontSize:8,color:T.muted}}>Capital inicial ($)</span>
          <input type="number" min="1" step="1" value={initialCapital}
            onChange={e=>setInitialCapital(parseFloat(e.target.value)||0)}
            className="mono" style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11}}/>
        </label>
        <label style={{display:"flex",flexDirection:"column",gap:3}}>
          <span style={{fontSize:8,color:T.muted}}>Stake actual ($)</span>
          <input type="number" min="0.01" step="0.01" value={positionSize}
            onChange={e=>setPositionSize(parseFloat(e.target.value)||DEFAULT_STAKE)}
            className="mono" style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11}}/>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:6,marginTop:14}}>
          <input type="checkbox" checked={stakeAutoScale} onChange={e=>setStakeAutoScale(e.target.checked)}/>
          <span style={{fontSize:9,color:T.muted}}>Escalado automático</span>
        </label>
      </div>
      {stakeAutoScale&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
          <label style={{display:"flex",flexDirection:"column",gap:3}}>
            <span style={{fontSize:8,color:T.muted}}>Incremento ($)</span>
            <input type="number" min="0.01" step="0.01" value={stakeStep}
              onChange={e=>setStakeStep(parseFloat(e.target.value)||0.05)}
              className="mono" style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11}}/>
          </label>
          <label style={{display:"flex",flexDirection:"column",gap:3}}>
            <span style={{fontSize:8,color:T.muted}}>Umbral de crecimiento (%)</span>
            <input type="number" min="1" step="1" value={Math.round(stakeGrowthTrigger*100)}
              onChange={e=>setStakeGrowthTrigger((parseFloat(e.target.value)||20)/100)}
              className="mono" style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11}}/>
          </label>
          <label style={{display:"flex",flexDirection:"column",gap:3}}>
            <span style={{fontSize:8,color:T.muted}}>Stake mínimo ($)</span>
            <input type="number" min="0.01" step="0.01" value={minStake}
              onChange={e=>setMinStake(parseFloat(e.target.value)||0.05)}
              className="mono" style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"5px 8px",fontSize:11}}/>
          </label>
        </div>
      )}
      {stakeAutoScale&&(()=>{
        const steps=Array.from({length:5},(_,i)=>+(minStake+stakeStep*i).toFixed(2));
        const curIdx=steps.reduce((best,s,i)=>Math.abs(s-positionSize)<Math.abs(steps[best]-positionSize)?i:best,0);
        const maxH=64;
        return(
          <>
            <div style={{fontSize:8,color:T.muted,letterSpacing:1,margin:"14px 0 8px"}}>ESCALERA DE STAKE</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:10,height:maxH+28,padding:"0 4px"}}>
              {steps.map((s,i)=>{
                const isCur=i===curIdx;
                const h=12+((i+1)/steps.length)*maxH;
                return(
                  <div key={s} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,flex:1}}>
                    <span className="mono" style={{fontSize:9,fontWeight:isCur?700:400,color:isCur?T.accent:T.muted}}>${s.toFixed(2)}</span>
                    <div style={{width:"100%",height:h,background:isCur?T.accent:T.border,borderRadius:"4px 4px 0 0",
                      boxShadow:isCur?`0 0 0 2px ${T.accent}55`:"none"}}/>
                    <span style={{fontSize:7,color:isCur?T.accent:T.muted,fontWeight:isCur?700:400}}>
                      {isCur?"ACTUAL":i===0?"mín":`+${Math.round((s/minStake-1)*100)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {stakeAutoScale&&(
        <div style={{fontSize:8,color:T.muted,marginTop:10,lineHeight:1.5}}>
          Cada vez que el balance suba (o baje) un {Math.round(stakeGrowthTrigger*100)}% desde el último ajuste,
          el stake sube (o baja) ${stakeStep.toFixed(2)}, sin bajar de ${minStake.toFixed(2)}.
          TP/SL se re-escalan automáticamente para mantener el mismo % de movimiento de precio validado por backtest.
        </div>
      )}
    </div>
  );
}
