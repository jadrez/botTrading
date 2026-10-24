import { T } from "../theme.js";

// Wide labeled sidebar (Opción B, approved design) — logo, contract-type
// switcher (Direccional is a visual placeholder only; Rise/Fall has no
// backtest or Deriv wiring yet, see api/deriv-order.js), and page nav.
// Replaces the old 3-tab bar (dashboard/signals/trading) with 5 real pages.
// "home" IS the chart/dashboard (the symbol's candles + análisis técnico +
// correlaciones) — it's the landing page, no click needed to see a chart.
// "signals" is the full watchlist table (click a row → jumps to "home" with
// that symbol loaded), kept as its own page per explicit request after the
// first cut folded it into Home and that buried the chart behind a click.
const NAV = [
  { id: "home", label: "Home", d: "M3 11l9-8 9 8M5 10v10h14V10M9 20v-6h6v6" },
  { id: "signals", label: "Señales", d: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" },
  { id: "historico", label: "Histórico", d: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2" },
  { id: "config", label: "Configuración", d: "M19.4 13a8 8 0 000-2l2.1-1.6-2-3.5-2.5 1a8 8 0 00-1.7-1L14.9 3h-4l-.4 2.9a8 8 0 00-1.7 1l-2.5-1-2 3.5L6.4 11a8 8 0 000 2l-2.1 1.6 2 3.5 2.5-1a8 8 0 001.7 1l.4 2.9h4l.4-2.9a8 8 0 001.7-1l2.5 1 2-3.5L19.4 13zM12 15a3 3 0 100-6 3 3 0 000 6z" },
];

function Icon({ d, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function Sidebar({ activeView, setActiveView, derivEnabled, derivBalance, derivLoginId, balance }) {
  const showingReal = derivEnabled && derivBalance != null;
  return (
    <nav aria-label="Navegación principal" className="app-sidebar"
      style={{ width: 240, flex: "0 0 240px", background: "#fff", borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column", padding: "20px 16px", minHeight: "100vh" }}>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26, padding: "0 4px" }}>
        <img src="/liju-logo.png" alt="Liju" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "contain" }} />
        <span className="sidebar-wordmark" style={{ fontSize: 14, fontWeight: 700 }}>Liju Trading</span>
      </div>

      <div className="sidebar-label" style={{ fontSize: 8, color: T.muted, letterSpacing: 1.5, fontWeight: 700, padding: "0 4px 8px" }}>TIPO DE CONTRATO</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 9,
          background: `${T.glow}14`, border: `1px solid ${T.glow}`, boxShadow: `0 0 14px -6px ${T.glow}` }}>
          <Icon d="M3 17l6-6 4 4 8-8M15 7h6v6" size={19} />
          <div>
            <div className="sidebar-label" style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>Basado en Crecimiento</div>
            <div className="sidebar-desc" style={{ fontSize: 9, color: T.muted }}>Multiplicadores · TP/SL continuo</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 9,
          border: "1px solid transparent", opacity: .6, cursor: "not-allowed" }} title="Aún sin backtest ni conexión a Deriv — ver Configuración">
          <Icon d="M12 20a8 8 0 100-16 8 8 0 000 16zM12 16a4 4 0 100-8 4 4 0 000 8z" size={19} />
          <div>
            <div className="sidebar-label" style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>Direccional</div>
            <div className="sidebar-desc" style={{ fontSize: 9, color: T.muted }}>Rise/Fall · próximamente</div>
          </div>
        </div>
      </div>

      <div className="sidebar-label" style={{ fontSize: 8, color: T.muted, letterSpacing: 1.5, fontWeight: 700, padding: "0 4px 8px" }}>NAVEGACIÓN</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV.map(n => {
          return (
            <button key={n.id} onClick={() => setActiveView(n.id)} aria-current={activeView === n.id ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9,
                cursor: "pointer", fontSize: 12, fontWeight: 600, border: "none", textAlign: "left", width: "100%",
                background: activeView === n.id ? `linear-gradient(135deg,${T.glow},#C9962B)` : "transparent",
                color: activeView === n.id ? "#1E1A10" : T.muted,
                boxShadow: activeView === n.id ? `0 0 14px -4px ${T.glow}` : "none" }}>
              <Icon d={n.d} />
              <span className="sidebar-label">{n.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "auto" }}>
        <div className="sidebar-label" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "13px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: .5, padding: "3px 8px", borderRadius: 5,
              background: T.dim, color: T.orange }}>{showingReal ? "DERIV" : "DEMO"}</span>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.green }} />
          </div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>
            ${(showingReal ? derivBalance : balance).toFixed(2)}
          </div>
          {showingReal && derivLoginId && (
            <div style={{ fontSize: 8, color: T.muted, marginTop: 3 }}>{derivLoginId}</div>
          )}
        </div>
      </div>
    </nav>
  );
}
