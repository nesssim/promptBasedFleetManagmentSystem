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

export function TopBar() {
  const phase = usePlanStore((s) => s.phase);
  const resetPlan = usePlanStore((s) => s.reset);
  const resetFleet = useFleetStore((s) => s.reset);
  const sessionId = useConfigStore((s) => s.sessionId);
  const connected = useFleetStore((s) => s.connected);
  const mockMode = useConfigStore((s) => s.mockMode);

  const handleKill = async () => {
    try {
      await postKill(sessionId);
    } catch {
      // Ignore — force reset anyway
    }
    resetPlan();
    resetFleet();
  };

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <span style={styles.logo}>MissionSwarm</span>
        {mockMode && <span style={styles.mockBadge}>MOCK</span>}
      </div>
      <div style={styles.right}>
        <span style={styles.phaseLabel}>{PHASE_LABELS[phase] || phase}</span>
        <span style={{ ...styles.statusDot, background: connected ? "#23a45d" : "#e5484d" }} />
        <button style={styles.killBtn} onClick={handleKill}>
          Kill All
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
  },
  left: { display: "flex", alignItems: "center", gap: 12 },
  right: { display: "flex", alignItems: "center", gap: 14 },
  logo: {
    fontSize: 20,
    fontWeight: 700,
    color: "#4f8ef7",
  },
  phaseLabel: {
    fontSize: 12,
    color: "#718096",
    fontWeight: 500,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  killBtn: {
    background: "#e5484d",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
    transition: "background 0.15s",
  },
  mockBadge: {
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 4,
    letterSpacing: "0.5px",
    marginLeft: 8,
  },
};
