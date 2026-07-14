import { useMemo } from "react";
import { useFleetStore } from "../stores/fleet";
import { usePlanStore } from "../stores/plan";
import { useConfigStore } from "../stores/config";
import { useWebSocket } from "../hooks/useWebSocket";
import { postKill } from "../api";
import { RobotCard } from "../components/RobotCard";
import { YardMap } from "../components/YardMap";
import { EventLog } from "../components/EventLog";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0d9488"];

export function DashboardView() {
  const robots = useFleetStore((s) => s.robots);
  const tasksCompleted = useFleetStore((s) => s.tasksCompleted);
  const tasksTotal = useFleetStore((s) => s.tasksTotal);
  const missionTime = useFleetStore((s) => s.missionTime);
  const connected = useFleetStore((s) => s.connected);
  const phase = usePlanStore((s) => s.phase);
  const currentDag = usePlanStore((s) => s.currentDag);
  const resetPlan = usePlanStore((s) => s.reset);
  const resetFleet = useFleetStore((s) => s.reset);
  const sessionId = useConfigStore((s) => s.sessionId);
  const robotCount = useConfigStore((s) => s.robotCount);
  const mockMode = useConfigStore((s) => s.mockMode);

  useWebSocket();

  const hasRobots = robots.length > 0;
  const hasRealDag = currentDag !== null && currentDag?.locations != null && Object.keys(currentDag.locations).length > 0;

  const logEntries = useMemo(() => {
    const e: Array<{ timestamp: string; type: "TASK" | "BATTERY" | "MISSION" | "ERROR"; message: string }> = [];
    const t = (s: number) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}:01`;
    for (const r of robots) {
      if (r.current_task) e.push({ timestamp: t(missionTime), type: "TASK", message: `${r.id} ${r.current_task}` });
      if (r.battery < 20) e.push({ timestamp: t(missionTime), type: "BATTERY", message: `${r.id} low battery (${Math.round(r.battery)}%)` });
    }
    if (phase === "complete") e.push({ timestamp: t(missionTime), type: "MISSION", message: `All ${tasksTotal} tasks done at ${missionTime.toFixed(1)}s` });
    return e;
  }, [robots, phase, missionTime, tasksTotal]);

  const isComplete = phase === "complete";

  return (
    <div style={styles.container}>
      {isComplete && (
        <div style={styles.completeBanner}>
          MISSION COMPLETE — {tasksCompleted}/{tasksTotal} tasks in {missionTime.toFixed(1)}s
        </div>
      )}

      <div style={styles.cardsSection}>
        {hasRobots ? (
          <div style={styles.cardsRow}>
            {robots.map((r, i) => (
              <RobotCard key={r.id} robot={r as any} color={COLORS[i % COLORS.length]} />
            ))}
          </div>
        ) : (
          <div style={styles.waitingRobots}>
            <div style={styles.waitingPulse} />
            <span style={styles.waitingText}>
              {mockMode
                ? "MOCK MODE — No robot telemetry. Connect ANTHROPIC_API_KEY and launch a real mission."
                : `Waiting for telemetry from ${robotCount} robot${robotCount > 1 ? 's' : ''}...`}
            </span>
          </div>
        )}
      </div>

      <div style={styles.middle}>
        <div style={styles.summary}>
          <SummaryRow label="Tasks" value={hasRobots ? `${tasksCompleted} / ${tasksTotal}` : "—"} />
          <SummaryRow label="Time" value={hasRobots ? `${missionTime.toFixed(1)}s` : "—"} />
          <SummaryRow label="Active" value={hasRobots ? `${robots.filter(r=>r.status!=="idle").length} / ${robots.length}` : "—"} />
          <SummaryRow label="Status" value={connected ? "Connected" : "Disconnected"}
            valueColor={connected ? "#16a34a" : "#dc2626"} />
        </div>
        {hasRealDag ? (
          <YardMap robots={robots} dag={currentDag} planned={false} />
        ) : (
          <div style={styles.emptyMap}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="5" y="10" width="30" height="18" rx="3" fill="#e2e8f0" />
              <circle cx="15" cy="22" r="4" fill="#cbd5e1" />
              <circle cx="25" cy="22" r="4" fill="#cbd5e1" />
            </svg>
            <div style={styles.emptyMapText}>
              {mockMode
                ? "MOCK MODE — No mission DAG loaded."
                : "Waiting for mission DAG..."}
            </div>
          </div>
        )}
      </div>

      <div style={styles.logSection}>
        <EventLog entries={logEntries} />
      </div>

      {isComplete && (
        <div style={styles.newMissionArea}>
          <button style={styles.newBtn} onClick={async () => {
            await postKill(sessionId); resetPlan(); resetFleet();
          }}>
            Start New Mission
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={styles.summaryRow}>
      <span style={styles.summaryLabel}>{label}</span>
      <span style={{ ...styles.summaryValue, ...(valueColor ? { color: valueColor } : {}) }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#f1f5f9",
    gap: 0,
    position: "relative",
  },
  completeBanner: {
    background: "#16a34a",
    color: "#fff",
    textAlign: "center",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  cardsSection: {
    padding: "10px 16px",
    borderBottom: "1px solid #e2e8f0",
    overflowX: "auto",
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  cardsRow: { display: "flex", gap: 8 },
  waitingRobots: { display: "flex", alignItems: "center", gap: 12, justifyContent: "center", padding: "16px 0" },
  waitingPulse: { width: 8, height: 8, borderRadius: "50%", background: "#94a3b8", animation: "pulse 2s infinite" },
  waitingText: { color: "#64748b", fontSize: 13, fontStyle: "italic" },
  middle: { flex: 1, display: "flex", overflow: "hidden" },
  summary: {
    width: 180,
    minWidth: 180,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#ffffff",
    borderRight: "1px solid #e2e8f0",
  },
  summaryRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { color: "#64748b", fontSize: 12 },
  summaryValue: { color: "#0f172a", fontSize: 13, fontWeight: 600 },
  emptyMap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#f1f5f9" },
  emptyMapText: { color: "#94a3b8", fontSize: 13, fontStyle: "italic" },
  logSection: { height: 200, minHeight: 200, borderTop: "1px solid #e2e8f0", background: "#ffffff" },
  newMissionArea: { position: "absolute", bottom: 220, left: "50%", transform: "translateX(-50%)" },
  newBtn: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
  },
};
