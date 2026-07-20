import { useEffect, useState } from "react";
import { useUIStore } from "../stores/ui";
import { useConfigStore } from "../stores/config";
import { usePlanStore } from "../stores/plan";
import {
  getSessions,
  getSessionDetail,
  restoreSession,
  type SessionSummary,
  type FullSessionData,
} from "../api";
import { colors } from "../theme";

function tryReformatPlan(raw: string): string {
  if (!raw || !raw.trim().startsWith("{")) return raw;
  try {
    // Backend stores str(dict) with single quotes; normalize to JSON
    const normalized = raw
      .replace(/'/g, '"')
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    const obj = JSON.parse(normalized);
    if (obj.human_summary || obj.flows || obj.robot_assignments) {
      // It's a plan — use the same formatting as ChatView's formatPlan
      const parts: string[] = [];
      if (obj.human_summary) { parts.push(obj.human_summary); parts.push(""); }
      const assignments = obj.robot_assignments as Array<Record<string, unknown>> | undefined;
      const flows = obj.flows as Array<Record<string, unknown>> | undefined;
      if (assignments && assignments.length > 0) {
        parts.push("Fleet assignments:");
        assignments.forEach((a) => {
          const flow = flows?.find((f: any) => f.id === a.flow_id);
          const taskCount = (flow?.tasks as Array<unknown>)?.length || 0;
          const flowLabel = (flow?.description as string) || (a.flow_id as string);
          parts.push(`  • ${a.robot_id} — ${flowLabel} (${taskCount} step${taskCount !== 1 ? "s" : ""})`);
        });
        parts.push("");
      }
      if (flows && flows.length > 0) {
        parts.push("Step-by-step plan:");
        flows.forEach((flow, i) => {
          const tasks = (flow.tasks || []) as Array<Record<string, unknown>>;
          const duration = flow.estimated_duration_s || "?";
          parts.push(`\nFlow ${i + 1}: ${flow.description || "Untitled"} (~${Math.round(Number(duration) / 60)}min)`);
          tasks.forEach((t, j) => {
            const loc = String(t.location || "?");
            const action = String(t.action || (t as any).action_type || "");
            const actionLabel = action ? ` (${action})` : "";
            parts.push(`  ${j + 1}. Go to ${loc}${actionLabel}`);
          });
        });
      }
      const totalDuration = obj.estimated_total_duration_s || "?";
      const taskCount = flows?.reduce((sum: number, f: any) => sum + ((f.tasks as Array<unknown>)?.length || 0), 0) || 0;
      parts.push(`\n${taskCount} tasks, ~${Math.round(Number(totalDuration) / 60)}min total`);
      return parts.join("\n");
    }
  } catch { /* not a plan, return as-is */ }
  return raw;
}

export function HistoryView() {
  const closeHistory = useUIStore((s) => s.closeHistory);
  const setSessionId = useConfigStore((s) => s.setSessionId);
  const setRobotCount = useConfigStore((s) => s.setRobotCount);
  const setPhase = usePlanStore((s) => s.setPhase);
  const setPlan = usePlanStore((s) => s.setPlan);
  const setDag = usePlanStore((s) => s.setDag);
  const addMessage = usePlanStore((s) => s.addMessage);
  const setCorrectionsRemaining = usePlanStore((s) => s.setCorrectionsRemaining);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FullSessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await getSessions();
        setSessions(res.sessions);
      } catch {
        /* ignore */
      }
      setLoading(false);
    })();
  }, []);

  const selectSession = async (id: string) => {
    setSelected(id);
    try {
      const d = await getSessionDetail(id);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      const res = await restoreSession(id);

      // Clear old conversation/plan/DAG before restoring — prevents stacking
      usePlanStore.getState().reset();

      setSessionId(res.session_id);
      setRobotCount(res.robot_count);
      setPhase(res.phase as any);
      if (res.plan) setPlan(res.plan);
      if (res.dag) setDag(res.dag as any);
      if (detail && detail.chat.length > 0) {
        for (const msg of detail.chat) {
          const content = msg.role === "assistant"
            ? tryReformatPlan(msg.content)
            : msg.content;
          addMessage({ role: msg.role as "user" | "assistant", content, timestamp: msg.timestamp });
        }
      }
      if (detail && detail.meta && typeof detail.meta.corrections_remaining === "number") {
        setCorrectionsRemaining(detail.meta.corrections_remaining as number);
      }
      closeHistory();
    } catch {
      alert("Failed to restore session. See server logs.");
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.title}>Session History</h2>
          <button style={styles.closeBtn} onClick={closeHistory}>
            &times;
          </button>
        </div>

        <div style={styles.body}>
          {/* Sidebar — session list */}
          <div style={styles.sidebar}>
            {loading && <p style={styles.muted}>Loading...</p>}
            {!loading && sessions.length === 0 && (
              <p style={styles.muted}>No sessions yet. Start a mission!</p>
            )}
            {sessions.map((s) => (
              <div
                key={s.session_id}
                style={{
                  ...styles.sessionRow,
                  background: selected === s.session_id ? colors.infoBg : undefined,
                }}
                onClick={() => selectSession(s.session_id)}
              >
                <div style={styles.sessionTitle}>{s.session_id.slice(0, 12)}...</div>
                <div style={styles.sessionMeta}>
                  <span style={styles.badge}>{s.phase}</span>
                  {s.mock && <span style={styles.mockBadge}>Mock</span>}
                  <span>{s.robot_count} robot(s)</span>
                  <span style={styles.date}>{formatDate(s.created_at)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div style={styles.detail}>
            {!detail && <p style={styles.muted}>Select a session to view details</p>}

            {detail && (
              <>
                <div style={styles.detailHeader}>
                  <h3 style={styles.detailTitle}>Session {selected?.slice(0, 12)}...</h3>
                  <button
                    style={styles.restoreBtn}
                    onClick={() => selected && handleRestore(selected)}
                  >
                    Restore Workflow
                  </button>
                </div>

                {/* Chat */}
                {detail.chat.length > 0 && (
                  <section style={styles.section}>
                    <h4 style={styles.sectionTitle}>Chat</h4>
                    {detail.chat.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          ...styles.chatMsg,
                          background: m.role === "user" ? colors.infoBg : colors.surface.default,
                        }}
                      >
                        <strong>{m.role}:</strong> {m.content}
                      </div>
                    ))}
                  </section>
                )}

                {/* Decisions */}
                {detail.decisions.length > 0 && (
                  <section style={styles.section}>
                    <h4 style={styles.sectionTitle}>Decisions</h4>
                    {detail.decisions.map((d, i) => (
                      <div key={i} style={styles.decisionRow}>
                        {d.decision}
                      </div>
                    ))}
                  </section>
                )}

                {/* Errors */}
                {detail.errors.length > 0 && (
                  <section style={styles.section}>
                    <h4 style={styles.sectionTitle}>Errors</h4>
                    {detail.errors.map((e, i) => (
                      <div key={i} style={styles.errorRow}>
                        {e.error}
                      </div>
                    ))}
                  </section>
                )}

                {/* Plan summary */}
                {detail.plan && (
                  <section style={styles.section}>
                    <h4 style={styles.sectionTitle}>Plan Data</h4>
                    <pre style={styles.pre}>
                      {JSON.stringify(detail.plan, null, 2)}
                    </pre>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: "90vw",
    maxWidth: 1100,
    height: "80vh",
    background: colors.surface.default,
    borderRadius: 12,
    boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 24px",
    borderBottom: `1px solid ${colors.border.default}`,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 24,
    cursor: "pointer",
    color: colors.text.muted,
    padding: "4px 8px",
    lineHeight: 1,
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  sidebar: {
    width: 300,
    borderRight: `1px solid ${colors.border.default}`,
    overflowY: "auto",
    padding: 8,
    flexShrink: 0,
  },
  sessionRow: {
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    marginBottom: 4,
    transition: "background 0.1s",
  },
  sessionTitle: {
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 4,
  },
  sessionMeta: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 11,
    color: colors.text.muted,
    flexWrap: "wrap",
  },
  badge: {
    background: colors.surface.muted,
    padding: "1px 6px",
    borderRadius: 4,
    fontWeight: 600,
    fontSize: 10,
  },
  date: { color: colors.text.faint },
  detail: {
    flex: 1,
    overflowY: "auto",
    padding: 20,
  },
  detailHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  detailTitle: { margin: 0, fontSize: 16, fontWeight: 700 },
  restoreBtn: {
    background: colors.primary,
    color: colors.primaryForeground,
    border: "none",
    borderRadius: 6,
    padding: "8px 18px",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    margin: "0 0 8px",
    fontSize: 14,
    fontWeight: 700,
    color: colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  chatMsg: {
    padding: "8px 12px",
    borderRadius: 6,
    marginBottom: 4,
    fontSize: 13,
    border: `1px solid ${colors.border.light}`,
  },
  decisionRow: {
    padding: "6px 12px",
    background: colors.infoBg,
    borderRadius: 6,
    marginBottom: 4,
    fontSize: 13,
    border: `1px solid ${colors.infoBorder}`,
  },
  errorRow: {
    padding: "6px 12px",
    background: colors.dangerBg,
    borderRadius: 6,
    marginBottom: 4,
    fontSize: 13,
    color: colors.danger,
    border: `1px solid ${colors.dangerBorder}`,
  },
  pre: {
    background: colors.surface.subtle,
    padding: 12,
    borderRadius: 6,
    fontSize: 11,
    overflowX: "auto",
    maxHeight: 300,
  },
  muted: { color: colors.text.faint, fontSize: 14 },
  mockBadge: {
    background: colors.warningBg,
    padding: "1px 6px",
    borderRadius: 4,
    fontWeight: 600,
    fontSize: 10,
    color: colors.warning,
  },
};
