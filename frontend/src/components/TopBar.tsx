import { usePlanStore } from "../stores/plan";
import { postKill } from "../api";
import { useConfigStore } from "../stores/config";
import { useFleetStore } from "../stores/fleet";

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  planning: "Planning",
  plan_ready: "Plan Ready",
  generating: "Generating DAG",
  dag_ready: "DAG Ready",
  launching: "Launching",
  running: "Running",
  complete: "Complete",
  error: "Error",
};

const NAV_ITEMS = [
  { id: "setup", label: "Setup", icon: "⚙" },
  { id: "planner", label: "Mission Planner", icon: "📋" },
  { id: "dashboard", label: "Dashboard", icon: "📊" },
];

export function Sidebar() {
  const phase = usePlanStore((s) => s.phase);
  const resetPlan = usePlanStore((s) => s.reset);
  const resetFleet = useFleetStore((s) => s.reset);
  const sessionId = useConfigStore((s) => s.sessionId);
  const connected = useFleetStore((s) => s.connected);
  const mockMode = useConfigStore((s) => s.mockMode);

  const showSetup = phase === "idle" || phase === "error";
  const showChat = ["planning", "plan_ready", "generating", "dag_ready"].includes(phase);
  const showDashboard = ["launching", "running", "complete"].includes(phase);

  const handleKill = async () => {
    try { await postKill(sessionId); } catch { /* force reset */ }
    resetPlan();
    resetFleet();
  };

  return (
    <div style={styles.sidebar}>
      {/* Logo */}
      <div style={styles.logoArea}>
        <div style={styles.logoIcon}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="5" width="18" height="11" rx="3" fill="#3b82f6" opacity="0.3" />
            <circle cx="8" cy="13" r="3" fill="#3b82f6" />
            <circle cx="14" cy="13" r="3" fill="#3b82f6" />
          </svg>
        </div>
        <div>
          <div style={styles.logoText}>MissionSwarm</div>
          <div style={styles.logoSub}>Fleet Manager</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={styles.nav}>
        <div style={styles.navSection}>Views</div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            (item.id === "setup" && showSetup) ||
            (item.id === "planner" && showChat) ||
            (item.id === "dashboard" && showDashboard);
          return (
            <div
              key={item.id}
              style={{
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              }}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          );
        })}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status area */}
      <div style={styles.statusArea}>
        {mockMode && (
          <div style={styles.mockBadge}>
            <span style={styles.mockDot} />
            MOCK MODE
          </div>
        )}
        <div style={styles.statusRow}>
          <span
            style={{
              ...styles.statusDot,
              background: connected ? "#16a34a" : "#94a3b8",
            }}
          />
          <span style={styles.statusLabel}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div style={styles.phaseRow}>
          <span style={styles.phaseLabel}>{PHASE_LABELS[phase] || phase}</span>
        </div>
        <button style={styles.killBtn} onClick={handleKill}>
          Kill All
        </button>
      </div>

      {/* Version */}
      <div style={styles.versionBar}>v1.0.0</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    minWidth: 220,
    height: "100vh",
    background: "#1e293b",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #0f172a",
    overflow: "hidden",
  },
  logoArea: {
    padding: "18px 16px 14px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderBottom: "1px solid #334155",
  },
  logoIcon: { display: "flex" },
  logoText: { color: "#f1f5f9", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" },
  logoSub: { color: "#64748b", fontSize: 10, fontWeight: 500, marginTop: 1 },
  nav: { padding: "8px 0", flex: 1, overflowY: "auto" },
  navSection: {
    padding: "8px 16px 4px",
    color: "#475569",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 16px",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 500,
    cursor: "default",
    transition: "all 0.1s",
  },
  navItemActive: {
    color: "#f1f5f9",
    background: "#334155",
    borderLeft: "3px solid #3b82f6",
    paddingLeft: 13,
  },
  navIcon: { width: 18, textAlign: "center" as const, fontSize: 13 },
  statusArea: {
    padding: "12px 16px",
    borderTop: "1px solid #334155",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  mockBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#422006",
    color: "#fbbf24",
    fontSize: 10,
    fontWeight: 700,
    padding: "3px 8px",
    borderRadius: 4,
    letterSpacing: "0.3px",
  },
  mockDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#fbbf24",
  },
  statusRow: { display: "flex", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  statusLabel: { color: "#94a3b8", fontSize: 11, fontWeight: 500 },
  phaseRow: {},
  phaseLabel: { color: "#64748b", fontSize: 10 },
  killBtn: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "5px 12px",
    fontWeight: 600,
    fontSize: 11,
    cursor: "pointer",
    marginTop: 2,
    transition: "background 0.15s",
  },
  versionBar: {
    padding: "8px 16px",
    color: "#475569",
    fontSize: 10,
    borderTop: "1px solid #334155",
    textAlign: "center" as const,
  },
};
