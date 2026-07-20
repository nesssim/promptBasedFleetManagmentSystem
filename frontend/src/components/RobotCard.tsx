import type { RobotState } from "../types";
import { colors } from "../theme";

interface RobotCardProps {
  robot: RobotState;
  color: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle:      { label: "Idle",      color: colors.text.faint },
  navigating:{ label: "Navigating",color: colors.primary },
  working:   { label: "Working",   color: colors.warning },
  charging:  { label: "Charging",  color: colors.success },
  error:     { label: "Error",     color: colors.danger },
};

export function RobotCard({ robot, color }: RobotCardProps) {
  const cfg = STATUS_CONFIG[robot.status] || STATUS_CONFIG.idle;
  const pct = Math.round(robot.battery);
  const batColor = pct > 50 ? colors.success : pct > 20 ? colors.warning : colors.danger;

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
    background: colors.surface.subtle,
    border: `1px solid ${colors.border.default}`,
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
  label: { fontSize: 11, color: colors.text.muted, minWidth: 40 },
  barOuter: { flex: 1, height: 6, background: colors.border.default, borderRadius: 3, overflow: "hidden" },
  barInner: { height: "100%", borderRadius: 3, transition: "width 0.5s ease" },
  detailRow: { display: "flex", gap: 4, fontSize: 11 },
  value: { color: colors.text.primary },
  coords: { fontSize: 10, color: colors.text.faint, fontFamily: "monospace" },
  progress: { fontSize: 11, color: colors.text.muted },
};
