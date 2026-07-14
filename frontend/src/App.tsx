import { usePlanStore } from "./stores/plan";
import { Sidebar } from "./components/TopBar";
import { SetupView } from "./views/SetupView";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { ErrorBanner } from "./components/ErrorBanner";

/**
 * Root application — Jenkins-inspired layout with dark sidebar.
 */
export default function App() {
  const phase = usePlanStore((s) => s.phase);
  const error = usePlanStore((s) => s.error);

  const showSetup = phase === "idle" || phase === "error";
  const showChat = ["planning", "plan_ready", "generating", "dag_ready"].includes(phase);
  const showDashboard = ["launching", "running", "complete"].includes(phase);

  return (
    <div style={styles.root}>
      <Sidebar />
      <div style={styles.main}>
        {/* Breadcrumb header */}
        <div style={styles.header}>
          <span style={styles.breadcrumb}>
            <span style={styles.breadItem}>Fleet</span>
            <span style={styles.breadSep}>/</span>
            <span style={{ ...styles.breadItem, color: "#0f172a", fontWeight: 600 }}>
              {showSetup && "Setup"}
              {showChat && "Mission Planner"}
              {showDashboard && "Dashboard"}
            </span>
          </span>
        </div>

        {/* Error banner */}
        {error && <ErrorBanner message={error} />}

        {/* Content */}
        <div style={styles.content}>
          {showSetup && <SetupView />}
          {showChat && <ChatView />}
          {showDashboard && <DashboardView />}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    overflow: "hidden",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#f1f5f9",
    overflow: "hidden",
  },
  header: {
    height: 44,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
  },
  breadcrumb: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 },
  breadItem: { color: "#64748b" },
  breadSep: { color: "#cbd5e1" },
  content: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
  },
};
