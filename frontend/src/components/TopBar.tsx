import { usePlanStore } from "../stores/plan";
import { postKill, postConfig, updatePrefs } from "../api";
import { useConfigStore } from "../stores/config";
import { useFleetStore } from "../stores/fleet";
import { useUIStore } from "../stores/ui";
import { LocationsEditor } from "./LocationsEditor";
import { AnimatedLogo } from "./AnimatedLogo";
import { colors } from "../theme";

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
  const provider = useConfigStore((s) => s.provider);
  const robotCount = useConfigStore((s) => s.robotCount);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const clearSession = useConfigStore((s) => s.clearSession);
  const openHistory = useUIStore((s) => s.openHistory);
  const openLocations = useUIStore((s) => s.openLocations);
  const showLocations = useUIStore((s) => s.showLocations);

  const handleKill = async () => {
    if (!confirm("Kill all robots and reset mission?")) return;
    try {
      await postKill(sessionId);
    } catch {
      // Ignore — force reset anyway
    }
    resetPlan();
    resetFleet();
    clearSession();
  };

  const changeRobotCount = (delta: number) => {
    const next = Math.max(1, Math.min(6, robotCount + delta));
    setRobotCount(next);
    updatePrefs({ default_robot_count: next }).catch(() => {});
    postConfig(next, sessionId).catch(() => {});
  };

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <AnimatedLogo badge={mockMode ? "MOCK" : null} />

        {/* Robot count controls — always visible */}
        <div style={styles.robotWidget}>
          <span style={styles.robotLabel}>Robots</span>
          <button style={styles.adjBtn} onClick={() => changeRobotCount(-1)}>
            &minus;
          </button>
          <span style={styles.robotVal}>{robotCount}</span>
          <button style={styles.adjBtn} onClick={() => changeRobotCount(1)}>
            +
          </button>
        </div>
      </div>
      <div style={styles.right}>
        {/* Provider badge */}
        <span
          style={styles.providerLabel}
          title="LLM provider"
        >
          {mockMode ? "MOCK" : provider.toUpperCase()}
        </span>
        <button style={styles.historyBtn} onClick={openHistory}>
          History
        </button>
        <button style={styles.locationsBtn} onClick={openLocations}>
          Locations
        </button>
        <span style={styles.phaseLabel}>{PHASE_LABELS[phase] || phase}</span>
        <span style={{ ...styles.statusDot, background: connected ? colors.status.connected : colors.status.disconnected }} />
        <button style={styles.killBtn} onClick={handleKill}>
          Kill All
        </button>
      </div>
      {showLocations && <LocationsEditor />}
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
    background: colors.surface.default,
    borderBottom: `1px solid ${colors.border.default}`,
  },
  left: { display: "flex", alignItems: "center", gap: 12 },
  right: { display: "flex", alignItems: "center", gap: 14 },
  phaseLabel: {
    fontSize: 12,
    color: colors.text.muted,
    fontWeight: 500,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  killBtn: {
    background: colors.primary,
    color: colors.primaryForeground,
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  },
  robotWidget: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginLeft: 8,
    borderLeft: `1px solid ${colors.border.default}`,
    paddingLeft: 12,
  },
  robotLabel: {
    fontSize: 11,
    color: colors.text.muted,
    fontWeight: 500,
    marginRight: 4,
  },
  adjBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    border: `1px solid ${colors.border.default}`,
    background: colors.surface.subtle,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  },
  robotVal: {
    fontSize: 14,
    fontWeight: 700,
    minWidth: 18,
    textAlign: "center",
  },
  historyBtn: {
    background: "transparent",
    color: colors.text.secondary,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 6,
    padding: "6px 14px",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  },
  locationsBtn: {
    background: "transparent",
    color: colors.text.secondary,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 6,
    padding: "6px 14px",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  },
  providerLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.text.muted,
    background: colors.surface.muted,
    padding: "2px 8px",
    borderRadius: 4,
    letterSpacing: "0.5px",
  },
};
