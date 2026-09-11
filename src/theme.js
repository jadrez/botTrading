/* ─── THEME ─────────────────────────────────────────────────────────────── */
export const T = {
  bg:"#04060f", panel:"#080d1c", card:"#0c1220", border:"#152035",
  accent:"#00b8e6", green:"#00e676", red:"#ff1744", yellow:"#ffd600",
  orange:"#ff6d00", text:"#c8d8f0", muted:"#344d70", dim:"#0f1828",
};

export const STYLES = `
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
