import { useState } from "react";
import { useConfigStore } from "../stores/config";
import { usePlanStore } from "../stores/plan";
import { postConfig } from "../api";

const ROBOT_COLORS = [
  "#4f8ef7",
  "#23a45d",
  "#e88d3b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
];

export function SetupView() {
  const robotCount = useConfigStore((s) => s.robotCount);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const setSessionId = useConfigStore((s) => s.setSessionId);
  const setMockMode = useConfigStore((s) => s.setMockMode);
  const mockMode = useConfigStore((s) => s.mockMode);
  const setPhase = usePlanStore((s) => s.setPhase);
  const setError = usePlanStore((s) => s.setError);
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postConfig(robotCount);
      setSessionId(res.session_id);
      setMockMode(res.mock);
      setPhase("planning");
    } catch (err: any) {
      setError(err.message || "Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Configure Your Fleet</h1>
          <p style={styles.subtitle}>Choose how many robots to deploy.</p>
        </div>

        <div style={styles.divider} />

        <div style={styles.sliderSection}>
          <div style={styles.sliderHeader}>
            <label style={styles.label}>Robot Count</label>
            <span style={styles.countBadge}>{robotCount}</span>
          </div>
          <div style={styles.sliderRow}>
            <span style={styles.sliderMin}>1</span>
            <input
              type="range"
              min={1}
              max={6}
              value={robotCount}
              onChange={(e) => setRobotCount(Number(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.sliderMax}>6</span>
          </div>
        </div>

        <div style={styles.robotGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              style={{
                ...styles.robotDot,
                background: i < robotCount ? ROBOT_COLORS[i] : "#e2e8f0",
                boxShadow:
                  i < robotCount
                    ? `0 0 0 2px ${ROBOT_COLORS[i]}33`
                    : "none",
              }}
            >
              <svg
                width="16"
                height="10"
                viewBox="0 0 16 10"
                style={{ opacity: i < robotCount ? 1 : 0.3 }}
              >
                <rect
                  x="1"
                  y="1"
                  width="14"
                  height="6"
                  rx="1.5"
                  fill={i < robotCount ? "#fff" : "#cbd5e1"}
                />
                <circle cx="5" cy="9" r="1" fill={i < robotCount ? "#fff" : "#cbd5e1"} />
                <circle cx="11" cy="9" r="1" fill={i < robotCount ? "#fff" : "#cbd5e1"} />
              </svg>
            </div>
          ))}
        </div>

        <div style={styles.divider} />

        <button
          style={{
            ...styles.startBtn,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
          onClick={handleStart}
          disabled={loading}
        >
          {loading ? "Connecting..." : "Launch Mission Planner"}
        </button>

        <div style={styles.mockRow}>
          {mockMode ? (
            <span style={styles.mockBadge}>MOCK MODE</span>
          ) : (
            <span style={styles.liveBadge}>LIVE</span>
          )}
          <span style={styles.mockHint}>
            {mockMode ? "No API key required" : "Claude API connected"}
          </span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f1f5f9",
    padding: 24,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "32px 36px",
    maxWidth: 600,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 0,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    margin: 0,
    lineHeight: 1.4,
  },
  divider: {
    height: 1,
    background: "#e2e8f0",
    margin: "20px 0",
  },
  sliderSection: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sliderHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#0f172a",
  },
  countBadge: {
    fontSize: 13,
    fontWeight: 700,
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 4,
    padding: "2px 10px",
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  sliderMin: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
    fontWeight: 600,
  },
  sliderMax: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
    fontWeight: 600,
  },
  slider: {
    flex: 1,
    height: 6,
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    background: "linear-gradient(to right, #2563eb 0%, #2563eb 0%, #e2e8f0 0%, #e2e8f0 100%)",
    borderRadius: 3,
    outline: "none",
    cursor: "pointer",
    accentColor: "#2563eb",
  },
  robotGrid: {
    display: "flex",
    gap: 10,
    justifyContent: "center",
    paddingTop: 4,
  },
  robotDot: {
    width: 32,
    height: 22,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  startBtn: {
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: 600,
    width: "100%",
    transition: "background 0.15s",
    cursor: "pointer",
    letterSpacing: 0.2,
  },
  mockRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  mockBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#92400e",
    background: "#fef3c7",
    border: "1px solid #fcd34d",
    borderRadius: 3,
    padding: "2px 8px",
    letterSpacing: 0.5,
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  },
  liveBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#166534",
    background: "#dcfce7",
    border: "1px solid #86efac",
    borderRadius: 3,
    padding: "2px 8px",
    letterSpacing: 0.5,
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  },
  mockHint: {
    fontSize: 11,
    color: "#94a3b8",
  },
};
