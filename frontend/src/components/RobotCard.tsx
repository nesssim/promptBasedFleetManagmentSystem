import type { RobotState } from "../types";

interface RobotCardProps {
  robot: RobotState;
  color: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle:      { label: "Idle",      color: "#a0aec0" },
  navigating:{ label: "Navigating",color: "#4f8ef7" },
  working:   { label: "Working",   color: "#e88d3b" },
  charging:  { label: "Charging",  color: "#23a45d" },
  error:     { label: "Error",     color: "#e53e3e" },
};

export function RobotCard({ robot, color }: RobotCardProps) {
  const cfg = STATUS_CONFIG[robot.status] || STATUS_CONFIG.idle;
  const pct = Math.round(robot.battery);
  const batColor = pct > 50 ? "#23a45d" : pct > 20 ? "#e88d3b" : "#e53e3e";

  return (
    <div style={{ ...styles.card, borderLeftColor: color }}>
      <div style={styles.header}>
        <span style={{ ...styles.name, color }}>{robot.id}</span>
        <span style={{ ...styles.badge, background: cfg.color, color: "#fff" }}>
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
    background: "#f8f9fa",
    border: "1px solid #e2e8f0",
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    minWidth: 170,
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 14, fontWeight: 700 },
  badge: { fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600 },
  batteryRow: { display: "flex", alignItems: "center", gap: 8 },
  label: { fontSize: 11, color: "#718096", minWidth: 40 },
  barOuter: { flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" },
  barInner: { height: "100%", borderRadius: 3, transition: "width 0.5s ease" },
  detailRow: { display: "flex", gap: 4, fontSize: 11 },
  value: { color: "#1a202c" },
  coords: { fontSize: 10, color: "#a0aec0", fontFamily: "monospace" },
  progress: { fontSize: 11, color: "#718096" },
};
