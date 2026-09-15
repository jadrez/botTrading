/* ─── THEME ─────────────────────────────────────────────────────────────── */
export const T = {
  bg:"#F5EFDF", panel:"#FFFFFF", card:"#FFFFFF", border:"#D8CDB0",
  accent:"#007A8A", green:"#00875A", red:"#D8112F", yellow:"#B98A00",
  orange:"#C97A00", text:"#201A12", muted:"#8A7F68", dim:"#EAE0C5",
};

export const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Barlow:wght@300;400;600;700;900&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:${T.bg};color:${T.text};font-family:'Barlow',sans-serif;overflow-x:hidden;font-size:16px;}
  ::-webkit-scrollbar{width:8px;height:8px;}
  ::-webkit-scrollbar-track{background:${T.bg};}
  ::-webkit-scrollbar-thumb{background:${T.border};border-radius:4px;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  button{font-family:'Barlow',sans-serif;transition:all .15s ease;}
  button:hover{filter:brightness(1.06);}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
  @keyframes breathe{0%,100%{box-shadow:0 0 0 0 #00C46A30}50%{box-shadow:0 0 0 6px #00C46A00}}
  .live::before{content:'';display:inline-block;width:9px;height:9px;border-radius:50%;background:#00C46A;animation:pulse 1.4s ease-in-out infinite;margin-right:6px;}
  .fade-up{animation:fadeUp .3s ease forwards;}
  .breathe{animation:breathe 2s ease-in-out infinite;}
`;
