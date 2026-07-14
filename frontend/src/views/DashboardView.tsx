import { useEffect, useMemo } from "react";
import { useFleetStore } from "../stores/fleet";
import { usePlanStore } from "../stores/plan";
import { useConfigStore } from "../stores/config";
import { useWebSocket } from "../hooks/useWebSocket";
import { postKill } from "../api";
import { RobotCard } from "../components/RobotCard";
import { YardMap } from "../components/YardMap";
import { EventLog } from "../components/EventLog";

const COLORS = ["#4f8ef7", "#23a45d", "#e88d3b", "#a855f7", "#ec4899", "#14b8a6"];

/**
 * View 4: Live Mission Dashboard
 * Light theme — clean white cards, subtle borders, blue accents.
 */
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

  useWebSocket();

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

      {/* Robot Cards */}
      <div style={styles.cardsSection}>
        <div style={styles.cardsRow}>
          {(robots.length > 0 ? robots : Array.from({ length: robotCount }, (_, i) => ({
            id: `robot_${i+1}`, status: "idle" as const, battery: 100,
            x: -4 + i*0.5, y: i%2===0 ? 0 : -2, current_task: "", completed_tasks: 0, total_tasks: 0
          }))).map((r, i) => (
            <RobotCard key={r.id} robot={r as any} color={COLORS[i % COLORS.length]} />
          ))}
        </div>
      </div>

      {/* Middle: Summary + Map */}
      <div style={styles.middle}>
        <div style={styles.summary}>
          <SummaryRow label="Tasks" value={`${tasksCompleted} / ${tasksTotal}`} />
          <SummaryRow label="Time" value={`${missionTime.toFixed(1)}s`} />
          <SummaryRow label="Active" value={`${robots.filter(r=>r.status!=="idle").length} / ${robots.length}`} />
          <SummaryRow label="Status" value={connected ? "Connected" : "Disconnected"}
            valueColor={connected ? "#23a45d" : "#e53e3e"} />
        </div>
        <YardMap robots={robots} dag={currentDag} planned={false} />
      </div>

      {/* Log */}
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
  container: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f8f9fa", position: "relative" },
  completeBanner: { background: "#23a45d", color: "#fff", textAlign: "center", padding: "10px 16px", fontSize: 15, fontWeight: 700 },
  cardsSection: { padding: "12px 16px", borderBottom: "1px solid #e2e8f0", overflowX: "auto", background: "#ffffff" },
  cardsRow: { display: "flex", gap: 10 },
  middle: { flex: 1, display: "flex", overflow: "hidden" },
  summary: {
    width: 180, minWidth: 180, padding: 16, display: "flex", flexDirection: "column", gap: 12,
    background: "#ffffff", borderRight: "1px solid #e2e8f0",
  },
  summaryRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { color: "#718096", fontSize: 12 },
  summaryValue: { color: "#1a202c", fontSize: 13, fontWeight: 600 },
  logSection: { height: 180, minHeight: 180, borderTop: "1px solid #e2e8f0", padding: "8px 16px", background: "#ffffff" },
  newMissionArea: { position: "absolute", bottom: 200, left: "50%", transform: "translateX(-50%)" },
  newBtn: { background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(79,142,247,0.3)" },
};
