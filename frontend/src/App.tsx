import { useEffect, useState } from "react";
import { usePlanStore } from "./stores/plan";
import { useConfigStore } from "./stores/config";
import { useUIStore } from "./stores/ui";
import { useHealthCheck } from "./hooks/useHealthCheck";
import { TopBar } from "./components/TopBar";
import { SetupView } from "./views/SetupView";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { HistoryView } from "./views/HistoryView";
import { ErrorBanner } from "./components/ErrorBanner";
import { getSession, getPrefs } from "./api";
import { colors } from "./theme";

export default function App() {
  const phase = usePlanStore((s) => s.phase);
  const error = usePlanStore((s) => s.error);
  const setPhase = usePlanStore((s) => s.setPhase);
  const sessionId = useConfigStore((s) => s.sessionId);
  const setSessionId = useConfigStore((s) => s.setSessionId);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const setMockMode = useConfigStore((s) => s.setMockMode);
  const showHistory = useUIStore((s) => s.showHistory);

  useHealthCheck();

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (sessionId) {
          try {
            const info = await getSession(sessionId);
            setPhase(info.phase as any);
            setRobotCount(info.robot_count);
          } catch {
            useConfigStore.getState().clearSession();
          }
        }
        if (!useConfigStore.getState().sessionId) {
          try {
            const prefs = await getPrefs();
            setRobotCount(prefs.default_robot_count);
          } catch {
            /* ignore */
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showSetup = phase === "idle" || phase === "error";
  const showChat = ["planning", "plan_ready", "generating", "dag_ready"].includes(phase);
  const showDashboard = ["launching", "running", "complete"].includes(phase);

  return (
    <div style={styles.container}>
      {loading ? (
        <div style={styles.loadingScreen}>
          <div style={styles.spinner} />
          <span style={styles.loadingText}>Loading MissionSwarm...</span>
        </div>
      ) : (
        <>
          <TopBar />

          {error && <ErrorBanner message={error} code={error.toUpperCase().replace(/\s+/g, "_")} />}

          <div style={styles.content}>
            {showHistory && <HistoryView />}
            {!showHistory && showSetup && <SetupView />}
            {!showHistory && showChat && <ChatView />}
            {!showHistory && showDashboard && <DashboardView />}
          </div>

          <div style={styles.bottomBar}>
            <span style={styles.version}>v1.0</span>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: colors.surface.default,
    color: colors.text.primary,
  },
  loadingScreen: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    background: colors.surface.subtle,
  },
  spinner: {
    width: 36,
    height: 36,
    border: `3px solid ${colors.border.default}`,
    borderTopColor: colors.primary,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: {
    color: colors.text.muted,
    fontSize: 14,
    fontWeight: 500,
  },
  content: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
  },
  bottomBar: {
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 16px",
    borderTop: `1px solid ${colors.border.default}`,
    background: colors.surface.subtle,
  },
  version: {
    color: colors.text.faint,
    fontSize: 11,
  },
};
