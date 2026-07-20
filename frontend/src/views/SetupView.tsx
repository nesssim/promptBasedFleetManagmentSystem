import { useState } from "react";
import { useConfigStore } from "../stores/config";
import { usePlanStore } from "../stores/plan";
import { postConfig } from "../api";
import { colors } from "../theme";

const ROBOT_COLORS = ["#4f8ef7", "#23a45d", "#e88d3b", "#a855f7", "#ec4899", "#14b8a6"];

/**
 * View 1: Setup Panel
 * Light, clean design — white card, soft shadow, no dark mode.
 */
export function SetupView() {
  const robotCount = useConfigStore((s) => s.robotCount);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const setSessionId = useConfigStore((s) => s.setSessionId);
  const setMockMode = useConfigStore((s) => s.setMockMode);
  const mockMode = useConfigStore((s) => s.mockMode);
  const provider = useConfigStore((s) => s.provider);
  const llmReachable = useConfigStore((s) => s.llmReachable);
  const llmError = useConfigStore((s) => s.llmError);
  const llmModel = useConfigStore((s) => s.llmModel);
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

  const renderProviderBadge = () => {
    if (mockMode) {
      return <span style={styles.mockBadge}>MOCK MODE — no API key required</span>;
    }

    switch (provider) {
      case "claude":
        return <span style={styles.liveBadge}>Live — Claude API connected</span>;
      case "gemini":
        return <span style={styles.liveBadge}>Live — Gemini API connected</span>;
      case "local":
        if (llmReachable) {
          const label = llmModel ? `Live — ${llmModel}` : "Live — Local LLM connected";
          return <span style={styles.liveBadge}>{label}</span>;
        }
        return (
          <span style={styles.offlineBadge}>
            {llmError || "Local LLM not reachable — start your model server"}
          </span>
        );
      default:
        return <span style={styles.offlineBadge}>No LLM configured</span>;
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect x="4" y="10" width="32" height="18" rx="4" fill={colors.primary} opacity="0.15" />
            <circle cx="14" cy="22" r="4" fill={colors.primary} />
            <circle cx="26" cy="22" r="4" fill={colors.primary} />
            <rect x="6" y="14" width="28" height="10" rx="2" fill={colors.primary} opacity="0.4" />
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
                background: i < robotCount ? ROBOT_COLORS[i] : colors.border.default,
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

        <div style={styles.mockRow}>
          {renderProviderBadge()}
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
    background: colors.surface.subtle,
  },
  card: {
    background: colors.surface.default,
    border: `1px solid ${colors.border.default}`,
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
    color: colors.text.primary,
    textAlign: "center",
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.muted,
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
    color: colors.text.secondary,
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
    background: colors.border.default,
    borderRadius: 3,
    outline: "none",
    cursor: "pointer",
    accentColor: colors.primary,
  },
  countCircle: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: colors.infoBg,
    color: colors.primary,
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
    color: colors.primaryForeground,
  },
  startBtn: {
    background: colors.primary,
    color: colors.primaryForeground,
    border: "none",
    borderRadius: 8,
    padding: "14px 24px",
    fontSize: 16,
    fontWeight: 700,
    width: "100%",
    cursor: "pointer",
  },
  mockRow: {
    display: "flex",
    justifyContent: "center",
  },
  mockBadge: {
    fontSize: 11,
    color: colors.badge.mock.text,
    background: colors.badge.mock.bg,
    padding: "4px 12px",
    borderRadius: 6,
    fontWeight: 600,
  },
  liveBadge: {
    fontSize: 11,
    color: colors.badge.live.text,
    background: colors.badge.live.bg,
    padding: "4px 12px",
    borderRadius: 6,
    fontWeight: 600,
  },
  offlineBadge: {
    fontSize: 11,
    color: colors.badge.offline.text,
    background: colors.badge.offline.bg,
    padding: "4px 12px",
    borderRadius: 6,
    fontWeight: 600,
  },
};
