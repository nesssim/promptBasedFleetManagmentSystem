import { useState, useRef, useEffect } from "react";

interface LogEntry {
  timestamp: string;
  type: "TASK" | "BATTERY" | "MISSION" | "ERROR";
  message: string;
}

interface EventLogProps {
  entries: LogEntry[];
}

const TYPE_COLORS: Record<string, string> = {
  TASK: "#4f8ef7",
  BATTERY: "#e88d3b",
  MISSION: "#23a45d",
  ERROR: "#e53e3e",
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
            <span style={{ ...styles.tag, background: TYPE_COLORS[e.type] || "#718096" }}>
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
    background: "#f8f9fa",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    overflow: "hidden",
    height: "100%",
  },
  filters: {
    display: "flex",
    gap: 6,
    padding: "8px 12px",
    borderBottom: "1px solid #e2e8f0",
    background: "#ffffff",
  },
  chip: {
    background: "transparent",
    color: "#718096",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "2px 10px",
    fontSize: 11,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  chipActive: {
    background: "#4f8ef7",
    color: "#fff",
    borderColor: "#4f8ef7",
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
  time: { color: "#a0aec0", minWidth: 60, fontSize: 11 },
  tag: {
    color: "#fff",
    fontSize: 9,
    padding: "1px 5px",
    borderRadius: 3,
    fontWeight: 600,
    minWidth: 40,
    textAlign: "center" as const,
  },
  msg: { color: "#1a202c" },
  empty: { color: "#a0aec0", textAlign: "center", padding: 20, fontSize: 12 },
};
