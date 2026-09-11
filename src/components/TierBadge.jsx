import { T } from "../theme.js";
import { SYMBOL_STRATEGY } from "../lib/symbolStrategy.js";

export default function TierBadge({symbol}){
  const strat=SYMBOL_STRATEGY[symbol];
  if(!strat) return null;
  const col=strat.tier==="ROBUSTO"?T.green:strat.tier==="MIXTO"?T.yellow:T.red;
  return(
    <span style={{fontSize:6,fontWeight:700,color:col,background:`${col}18`,
      padding:"1px 5px",borderRadius:3,letterSpacing:.5,whiteSpace:"nowrap"}}>
      {strat.tier==="SIN-EDGE"?"🔒 SIN-EDGE":strat.tier}
    </span>
  );
}
