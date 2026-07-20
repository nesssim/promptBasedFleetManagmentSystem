import { useState, useRef, useEffect } from "react";
import { colors } from "../theme";

interface LogEntry {
  timestamp: string;
  type: "TASK" | "BATTERY" | "MISSION" | "ERROR";
  message: string;
}

interface EventLogProps {
  entries: LogEntry[];
}

const TYPE_COLORS: Record<string, string> = {
  TASK: colors.primary,
  BATTERY: colors.warning,
  MISSION: colors.success,
  ERROR: colors.danger,
};

export function EventLog({ entries }: EventLogProps) {
  const [filter, setFilter] = useState("All");
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = filter === "All"
    ? entries
    : entries.filter((e) => e.type === filter.toUpperCase().replace("ERRORS", "ERROR").replace("TASKS", "TASK"));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const filters = ["All", "Tasks", "Battery", "Errors"];

  return (
    <div style={styles.container}>
      <div style={styles.filters}>
        {filters.map((f) => (
          <button key={f} style={{ ...styles.chip, ...(filter === f ? styles.chipActive : {}) }} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <div style={styles.list}>
        {filtered.length === 0 && <div style={styles.empty}>No events yet</div>}
        {filtered.map((e, i) => (
          <div key={i} style={styles.entry}>
            <span style={styles.time}>{e.timestamp}</span>
            <span style={{ ...styles.tag, background: TYPE_COLORS[e.type] || colors.text.muted }}>
              {e.type}
            </span>
            <span style={styles.msg}>{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    background: colors.surface.subtle,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 8,
    overflow: "hidden",
    height: "100%",
  },
  filters: {
    display: "flex",
    gap: 6,
    padding: "8px 12px",
    borderBottom: `1px solid ${colors.border.default}`,
    background: colors.surface.default,
  },
  chip: {
    background: "transparent",
    color: colors.text.muted,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 12,
    padding: "2px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  chipActive: {
    background: colors.primary,
    color: colors.primaryForeground,
    borderColor: colors.primary,
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  },
  entry: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "3px 12px",
    fontSize: 12,
    fontFamily: "monospace",
  },
  time: { color: colors.text.faint, minWidth: 60, fontSize: 11 },
  tag: {
    color: colors.primaryForeground,
    fontSize: 9,
    padding: "1px 5px",
    borderRadius: 3,
    fontWeight: 600,
    minWidth: 40,
    textAlign: "center" as const,
  },
  msg: { color: colors.text.primary },
  empty: { color: colors.text.faint, textAlign: "center", padding: 20, fontSize: 12 },
};
