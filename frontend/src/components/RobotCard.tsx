import type { RobotState } from "../types";

interface RobotCardProps {
  robot: RobotState;
  color: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle:       { label: "Idle",       color: "#94a3b8" },
  navigating: { label: "Navigating", color: "#2563eb" },
  working:    { label: "Working",    color: "#d97706" },
  charging:   { label: "Charging",   color: "#16a34a" },
  error:      { label: "Error",      color: "#dc2626" },
};

export function RobotCard({ robot, color }: RobotCardProps) {
  const cfg = STATUS_CONFIG[robot.status] || STATUS_CONFIG.idle;
  const pct = Math.round(robot.battery);
  const batColor = pct > 50 ? "#16a34a" : pct > 20 ? "#d97706" : "#dc2626";

  return (
    <div style={{ ...styles.card, borderLeftColor: color }}>
      <div style={styles.header}>
        <span style={{ ...styles.name, color }}>{robot.id}</span>
        <span style={{ ...styles.badge, background: cfg.color }}>
          {cfg.label}
        </span>
      </div>
      <div style={styles.batteryRow}>
        <span style={styles.label}>Battery</span>
        <div style={styles.barOuter}>
          <div style={{ ...styles.barInner, width: `${pct}%`, background: batColor }} />
        </div>
        <span style={{ color: batColor, fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: "right" as const }}>
          {pct}%
        </span>
      </div>
      <div style={styles.detailRow}>
        <span style={styles.label}>Task:</span>
        <span style={styles.value}>{robot.current_task || "Idle"}</span>
      </div>
      <div style={styles.coords}>
        ({robot.x.toFixed(1)}, {robot.y.toFixed(1)})
      </div>
      <div style={styles.progress}>
        {robot.completed_tasks} / {robot.total_tasks} tasks
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderLeftWidth: 4,
    borderRadius: 6,
    padding: 10,
    minWidth: 170,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 14, fontWeight: 700 },
  badge: { fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, color: "#fff" },
  batteryRow: { display: "flex", alignItems: "center", gap: 8 },
  label: { fontSize: 11, color: "#64748b", minWidth: 40 },
  barOuter: { flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" },
  barInner: { height: "100%", borderRadius: 3, transition: "width 0.5s ease" },
  detailRow: { display: "flex", gap: 4, fontSize: 11 },
  value: { color: "#0f172a" },
  coords: { fontSize: 10, color: "#94a3b8", fontFamily: "'SF Mono', 'JetBrains Mono', monospace" },
  progress: { fontSize: 11, color: "#64748b" },
};
