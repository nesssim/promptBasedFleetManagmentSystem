import { useState } from "react";
import { useConfigStore } from "../stores/config";
import { usePlanStore } from "../stores/plan";
import { postConfig } from "../api";

const ROBOT_COLORS = ["#4f8ef7", "#23a45d", "#e88d3b", "#a855f7", "#ec4899", "#14b8a6"];

/**
 * View 1: Setup Panel
 * Light, clean design — white card, soft shadow, no dark mode.
 */
export function SetupView() {
  const robotCount = useConfigStore((s) => s.robotCount);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const setSessionId = useConfigStore((s) => s.setSessionId);
  const setPhase = usePlanStore((s) => s.setPhase);
  const setError = usePlanStore((s) => s.setError);
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postConfig(robotCount);
      setSessionId(res.session_id);
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
        <div style={styles.iconWrap}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect x="4" y="10" width="32" height="18" rx="4" fill="#4f8ef7" opacity="0.15" />
            <circle cx="14" cy="22" r="4" fill="#4f8ef7" />
            <circle cx="26" cy="22" r="4" fill="#4f8ef7" />
            <rect x="6" y="14" width="28" height="10" rx="2" fill="#4f8ef7" opacity="0.4" />
          </svg>
        </div>

        <h1 style={styles.title}>Configure Your Fleet</h1>
        <p style={styles.subtitle}>Choose how many robots you want to command.</p>

        {/* Slider */}
        <div style={styles.sliderSection}>
          <label style={styles.label}>Number of Robots</label>
          <div style={styles.sliderRow}>
            <input
              type="range"
              min={1}
              max={6}
              value={robotCount}
              onChange={(e) => setRobotCount(Number(e.target.value))}
              style={styles.slider}
            />
            <div style={styles.countCircle}>{robotCount}</div>
          </div>
          <div style={styles.iconsRow}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{
                ...styles.robotIcon,
                background: i < robotCount ? ROBOT_COLORS[i] : "#e2e8f0",
                opacity: i < robotCount ? 1 : 0.4,
                transition: "all 0.2s ease",
              }}>
                <svg width="20" height="14" viewBox="0 0 20 14">
                  <rect x="1" y="3" width="18" height="8" rx="2" fill="currentColor" />
                  <circle cx="6" cy="10" r="2" fill="#fff" />
                  <circle cx="14" cy="10" r="2" fill="#fff" />
                </svg>
              </div>
            ))}
          </div>
        </div>

        <button
          style={{ ...styles.startBtn, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          onClick={handleStart}
          disabled={loading}
        >
          {loading ? "Connecting..." : "Launch Mission Planner"}
        </button>

        <p style={styles.note}>
          API key is configured on the server — no setup needed in the browser.
        </p>
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
    background: "#f8f9fa",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "36px 44px",
    maxWidth: 460,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    margin: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  iconWrap: {
    display: "flex",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "#1a202c",
    textAlign: "center",
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: "#718096",
    textAlign: "center",
    margin: 0,
    marginTop: -12,
  },
  sliderSection: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  label: {
    fontSize: 14,
    color: "#4a5568",
    fontWeight: 600,
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  slider: {
    flex: 1,
    height: 6,
    appearance: "none",
    background: "#e2e8f0",
    borderRadius: 3,
    outline: "none",
    cursor: "pointer",
    accentColor: "#4f8ef7",
  },
  countCircle: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "#ebf4ff",
    color: "#4f8ef7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    fontWeight: 700,
  },
  iconsRow: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
  },
  robotIcon: {
    width: 30,
    height: 22,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
  },
  startBtn: {
    background: "#4f8ef7",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "14px 24px",
    fontSize: 16,
    fontWeight: 700,
    width: "100%",
    transition: "background 0.15s",
    cursor: "pointer",
  },
  note: {
    fontSize: 11,
    color: "#a0aec0",
    textAlign: "center",
    margin: 0,
  },
};
