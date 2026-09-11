import { T } from "../theme.js";

export default function SchedulePanel({scheduledStart, setScheduledStart, scheduleInput, setScheduleInput, scheduleRemainingMs, autoMode, addLog}){
  return(
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 6v6l4 2" stroke={T.accent} strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="12" r="9" stroke={T.accent} strokeWidth="2"/></svg>
        <span style={{fontSize:8,color:T.muted,letterSpacing:2}}>INICIO AUTOMÁTICO PROGRAMADO</span>
      </div>
      {!scheduledStart?(
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <input type="datetime-local" value={scheduleInput} onChange={e=>setScheduleInput(e.target.value)}
            min={new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}
            style={{background:T.dim,border:`1px solid ${T.border}`,color:T.text,borderRadius:6,padding:"7px 10px",fontSize:11,fontFamily:"inherit"}}/>
          <button disabled={!scheduleInput||autoMode}
            onClick={()=>{
              const ts=new Date(scheduleInput).getTime();
              if(isNaN(ts)||ts<=Date.now()){addLog("⚠️ Elige una fecha/hora futura válida","sell");return;}
              setScheduledStart(ts);
              addLog(`⏰ AUTO se activará el ${new Date(ts).toLocaleString("es")}`,"info");
            }}
            style={{background:!scheduleInput||autoMode?T.dim:`${T.accent}18`,border:`1px solid ${!scheduleInput||autoMode?T.border:T.accent}`,
              color:!scheduleInput||autoMode?T.muted:T.accent,borderRadius:6,padding:"7px 14px",fontSize:11,fontWeight:700,
              cursor:!scheduleInput||autoMode?"not-allowed":"pointer"}}>
            Programar
          </button>
          {autoMode&&<span style={{fontSize:9,color:T.muted}}>AUTO ya está encendido</span>}
        </div>
      ):(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,
          background:T.dim,border:`1px solid ${T.accent}45`,borderRadius:8,padding:"12px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:34,height:34,borderRadius:8,background:`${T.accent}18`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke={T.accent} strokeWidth="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round"/></svg>
            </div>
            <div>
              <div style={{fontSize:7,color:T.muted,letterSpacing:1,marginBottom:2}}>AUTO SE ACTIVARÁ EL</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:T.accent}}>{new Date(scheduledStart).toLocaleString("es")}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {scheduleRemainingMs!=null&&(
              <div style={{textAlign:"right"}}>
                <div className="mono" style={{fontSize:14,fontWeight:700,color:T.text}}>
                  {String(Math.floor(scheduleRemainingMs/3600000)).padStart(2,"0")}:
                  {String(Math.floor(scheduleRemainingMs%3600000/60000)).padStart(2,"0")}:
                  {String(Math.floor(scheduleRemainingMs%60000/1000)).padStart(2,"0")}
                </div>
                <div style={{fontSize:6,color:T.muted,letterSpacing:1}}>TIEMPO RESTANTE</div>
              </div>
            )}
            <button onClick={()=>{setScheduledStart(null);addLog("⏰ Programación de inicio cancelada","info");}}
              style={{background:"transparent",border:`1px solid ${T.red}`,color:T.red,borderRadius:6,padding:"6px 12px",fontSize:10,fontWeight:700,cursor:"pointer"}}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
