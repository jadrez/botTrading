import { T } from "../theme.js";

export default function RangeBar({entry, target, stop, isHold, precision=5}){
  if(isHold||target==null||stop==null){
    return(
      <div>
        <div style={{height:6,borderRadius:3,background:T.border}}/>
        <div style={{fontSize:10,color:T.muted,marginTop:3}}>—</div>
      </div>
    );
  }
  const riskPips=Math.abs(entry-stop);
  const rewardPips=Math.abs(target-entry);
  const total=riskPips+rewardPips;
  const entryPct=total>0?(riskPips/total)*100:50;
  return(
    <div>
      <div style={{position:"relative",height:6,borderRadius:3,overflow:"hidden",display:"flex"}}>
        <div style={{width:`${entryPct}%`,background:`${T.red}50`}}/>
        <div style={{width:`${100-entryPct}%`,background:`${T.green}60`}}/>
        <div style={{position:"absolute",left:`${entryPct}%`,top:-3,width:2,height:12,background:T.text}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,marginTop:3,gap:6}}>
        <span className="mono" style={{color:T.red}}>🛑 {stop.toFixed(precision)}</span>
        <span className="mono" style={{color:T.green}}>🎯 {target.toFixed(precision)}</span>
      </div>
    </div>
  );
}
