import { T } from "../theme.js";

export default function SignalDistribution({buy, sell, hold}){
  const total=buy+sell+hold;
  const r=45, circ=2*Math.PI*r;
  const buyLen=total?(buy/total)*circ:0;
  const sellLen=total?(sell/total)*circ:0;
  const holdLen=total?(hold/total)*circ:circ;
  return(
    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:2,marginBottom:14}}>DISTRIBUCIÓN DE SEÑALES · {total} PARES</div>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <svg width="100" height="100" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke={T.border} strokeWidth="14"/>
          <circle cx="60" cy="60" r={r} fill="none" stroke={T.green} strokeWidth="14"
            strokeDasharray={`${buyLen} ${circ-buyLen}`} strokeDashoffset="0" transform="rotate(-90 60 60)" strokeLinecap="round"/>
          <circle cx="60" cy="60" r={r} fill="none" stroke={T.red} strokeWidth="14"
            strokeDasharray={`${sellLen} ${circ-sellLen}`} strokeDashoffset={-buyLen} transform="rotate(-90 60 60)"/>
          <text x="60" y="56" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="22" fontWeight="700" fill={T.text}>{total}</text>
          <text x="60" y="72" textAnchor="middle" fontFamily="Barlow,sans-serif" fontSize="8" fill={T.muted} letterSpacing="1">PARES</text>
        </svg>
        <div style={{display:"flex",flexDirection:"column",gap:8,flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:9,height:9,borderRadius:2,background:T.green}}/>
            <span style={{fontSize:10,color:T.text}}>Compra</span>
            <span className="mono" style={{fontSize:11,fontWeight:700,color:T.green,marginLeft:"auto"}}>{buy}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:9,height:9,borderRadius:2,background:T.red}}/>
            <span style={{fontSize:10,color:T.text}}>Venta</span>
            <span className="mono" style={{fontSize:11,fontWeight:700,color:T.red,marginLeft:"auto"}}>{sell}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:9,height:9,borderRadius:2,background:T.muted}}/>
            <span style={{fontSize:10,color:T.text}}>Hold</span>
            <span className="mono" style={{fontSize:11,fontWeight:700,color:T.muted,marginLeft:"auto"}}>{hold}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
