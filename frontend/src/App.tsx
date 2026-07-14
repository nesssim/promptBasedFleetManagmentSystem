import { usePlanStore } from "./stores/plan";
import { TopBar } from "./components/TopBar";
import { SetupView } from "./views/SetupView";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { ErrorBanner } from "./components/ErrorBanner";

/**
 * Root application component.
 * Routes between 3 views based on mission phase.
 */
export default function App() {
  const phase = usePlanStore((s) => s.phase);
  const error = usePlanStore((s) => s.error);

  const showSetup = phase === "idle" || phase === "error";
  const showChat = ["planning", "plan_ready", "generating", "dag_ready"].includes(phase);
  const showDashboard = ["launching", "running", "complete"].includes(phase);

  return (
    <div style={styles.container}>
      <TopBar />

      {error && <ErrorBanner message={error} code={error.toUpperCase().replace(/\s+/g, "_")} />}

      <div style={styles.content}>
        {showSetup && <SetupView />}
        {showChat && <ChatView />}
        {showDashboard && <DashboardView />}
      </div>

      {/* Bottom Bar */}
      <div style={styles.bottomBar}>
        <span style={styles.version}>v1.0</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#ffffff",
    color: "#1a202c",
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
    borderTop: "1px solid #e2e8f0",
    background: "#f8f9fa",
  },
  version: {
    color: "#a0aec0",
    fontSize: 11,
  },
};
