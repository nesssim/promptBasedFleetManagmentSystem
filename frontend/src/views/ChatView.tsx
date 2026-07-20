import { useState, useRef, useEffect, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { usePlanStore } from "../stores/plan";
import { useConfigStore } from "../stores/config";
import { postPlan, postCorrect, postGenerate, postLaunch, getWslCheck } from "../api";
import { YardMap } from "../components/YardMap";
import { colors } from "../theme";

export function ChatView() {
  const {
    phase, conversation, currentPlan, currentDag, correctionsRemaining,
    addMessage, setPlan, setDag, setPhase, setError, setCorrectionsRemaining,
  } = usePlanStore(
    (s) => ({
      phase: s.phase, conversation: s.conversation, currentPlan: s.currentPlan,
      currentDag: s.currentDag, correctionsRemaining: s.correctionsRemaining,
      addMessage: s.addMessage, setPlan: s.setPlan, setDag: s.setDag,
      setPhase: s.setPhase, setError: s.setError, setCorrectionsRemaining: s.setCorrectionsRemaining,
    }),
    shallow
  );
  const sessionId = useConfigStore((s) => s.sessionId);
  const mockMode = useConfigStore((s) => s.mockMode);
  const provider = useConfigStore((s) => s.provider);
  const llmReachable = useConfigStore((s) => s.llmReachable);
  const llmError = useConfigStore((s) => s.llmError);

  const [missionText, setMissionText] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wslCheck, setWslCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [wslChecking, setWslChecking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [conversation]);

  useEffect(() => {
    if (phase === "dag_ready" && !wslCheck && !wslChecking) {
      setWslChecking(true);
      getWslCheck().then((r) => {
        if (r.wsl_installed && r.ros2_available && r.gazebo_available) {
          setWslCheck({ ok: true, message: "WSL + ROS2 + Gazebo detected. Ready to launch." });
        } else {
          const lines = r.details.filter((d) => d.includes("NOT") || d.includes("not") || d.includes("Install"));
          setWslCheck({
            ok: false,
            message: lines.length > 0 ? lines.join("\n") : "WSL environment incomplete — see details below.",
          });
        }
      }).catch((e) => {
        setWslCheck({ ok: false, message: `WSL check failed: ${e.message}` });
      }).finally(() => setWslChecking(false));
    }
    if (phase !== "dag_ready") setWslCheck(null);
  }, [phase, wslCheck, wslChecking]);

  const hasRealDag = currentDag !== null && currentDag?.locations != null && Object.keys(currentDag.locations).length > 0;

  const handleSend = useCallback(async () => {
    if (!missionText.trim() || loading) return;
    const text = missionText;
    setMissionText("");
    setLoading(true);
    setError(null);
    addMessage({ role: "user", content: text, timestamp: Date.now() });
    try {
      const r = await postPlan(text, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setPhase(r.phase as any);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({
        role: "assistant",
        content: r.mock
          ? `[MOCK MODE] Mission "${text}" received. No LLM connected — connect an ANTHROPIC_API_KEY to generate a real plan. The YardMap will show locations once a real DAG is generated.`
          : formatPlan(r.plan),
        timestamp: Date.now(),
      });
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [missionText, loading, sessionId, addMessage, setPlan, setPhase, setCorrectionsRemaining, setError]);

  const handleRevise = useCallback(async () => {
    if (!correctionText.trim() || loading) return;
    const text = correctionText;
    setCorrectionText("");
    setLoading(true);
    setError(null);
    setShowCorrection(false);
    addMessage({ role: "user", content: text, timestamp: Date.now() });
    try {
      const r = await postCorrect(text, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setPhase(r.phase as any);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({
        role: "assistant",
        content: r.mock
          ? "[MOCK MODE] Correction noted. No LLM connected — no plan was updated."
          : formatPlan(r.plan),
        timestamp: Date.now(),
      });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [correctionText, loading, sessionId, addMessage, setPlan, setCorrectionsRemaining, setError]);

  const handleAccept = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await postGenerate(sessionId);
      setDag(r.dag as any);
      setPhase(r.phase as any);
      setCorrectionsRemaining(r.corrections_remaining);
      if (!r.dag) {
        addMessage({
          role: "assistant",
          content: "[MOCK MODE] No real DAG generated. Connect an ANTHROPIC_API_KEY to create actual tasks and locations.",
          timestamp: Date.now(),
        });
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [loading, sessionId, setDag, setPhase, addMessage, setError]);

  const handleLaunch = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await postLaunch(sessionId);
      setPhase("running");
    } catch (e: any) {
      console.warn("[launch] Failed to launch (expected in mock mode without Gazebo)");
      setError(e?.message || "Launch failed");
      setPhase("error");
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [loading, sessionId, setError, setPhase]);

  return (
    <div style={styles.container}>
      {/* Left — Chat */}
      <div style={styles.chatPanel}>
        <div style={styles.chatHeader}>
          <span style={styles.chatTitle}>Mission Chat</span>
          <button style={styles.newBtn} onClick={() => { setPhase("idle"); usePlanStore.getState().reset(); }}>
            + New Mission
          </button>
        </div>
        <div style={styles.messages}>
          {conversation.length === 0 && (
            <div style={styles.placeholder}>
              <div style={styles.placeholderIcon}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <rect x="3" y="6" width="30" height="20" rx="4" stroke={colors.border.default} strokeWidth="1.5" fill="none" />
                  <path d="M3 22l8-5 4 3 8-6 10 6" stroke={colors.border.default} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={styles.placeholderTitle}>Describe your mission</div>
              <div style={styles.placeholderHint}>
                e.g. "Survey zone A and zone B, then charge"
              </div>
            </div>
          )}
          {conversation.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div key={i} style={{
                ...styles.bubble,
                alignSelf: isUser ? "flex-end" : "flex-start",
                ...(isUser ? styles.bubbleUser : styles.bubbleAssistant),
                whiteSpace: "pre-wrap" as const,
              }}>
                {!isUser && <span style={styles.bubbleRole}>Assistant</span>}
                <div style={styles.bubbleContent}>{m.content}</div>
              </div>
            );
          })}
          {loading && (
            <div style={{ ...styles.bubble, ...styles.bubbleAssistant, alignSelf: "flex-start" }}>
              <span style={styles.bubbleRole}>Assistant</span>
              <div style={styles.typing}>
                <span style={styles.typingDot} />
                <span style={{ ...styles.typingDot, animationDelay: "0.15s" }} />
                <span style={{ ...styles.typingDot, animationDelay: "0.3s" }} />
              </div>
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        <div style={styles.inputArea}>
          {provider === "local" && !llmReachable && (
            <div style={styles.llmWarning}>
              Local LLM not reachable — start your model server before sending missions.
              {llmError && <span style={{ display: "block", fontSize: 10, marginTop: 2, opacity: 0.8 }}>{llmError}</span>}
            </div>
          )}
          <div style={styles.inputRow}>
            <textarea style={styles.textInput} placeholder="Describe your mission..." rows={2}
              value={missionText}
              onChange={(e) => setMissionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}} />
            <button style={{ ...styles.sendBtn, opacity: (!missionText.trim() || loading) ? 0.5 : 1 }}
              onClick={handleSend} disabled={loading || !missionText.trim()}>
              {loading ? "..." : "Send"}
            </button>
          </div>
        </div>
      </div>

      {/* Right — Plan Visualizer */}
      <div style={styles.planPanel}>
        <div style={styles.planHeader}>
          <span style={styles.planTitle}>Task Plan</span>
          {correctionsRemaining < 3 && (
            <span style={styles.correctionBadge}>{correctionsRemaining} corrections left</span>
          )}
        </div>

        {hasRealDag ? (
          <div style={styles.mapContainer}>
            <YardMap dag={currentDag} planned />
          </div>
        ) : (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="8" width="32" height="32" rx="4" stroke={colors.border.default} strokeWidth="1.5" fill="none" />
                <path d="M16 16h16M16 24h12M16 32h8" stroke={colors.border.default} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="36" cy="36" r="8" fill={colors.surface.default} stroke={colors.border.default} strokeWidth="1.5" />
                <path d="M36 33v6M33 36h6" stroke={colors.primary} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div style={styles.emptyTitle}>
              {mockMode ? "No Plan Data" : "No Task Plan Yet"}
            </div>
            <div style={styles.emptyHint}>
              {mockMode
                ? "Connect ANTHROPIC_API_KEY to generate a mission DAG with real tasks and locations."
                : "Send a mission description to generate a task plan with flows and robot assignments."}
            </div>
          </div>
        )}

        <div style={styles.controls}>
          {phase === "dag_ready" ? (
            wslCheck === null || wslChecking ? (
              <button style={styles.launchBtn} disabled>
                {wslChecking ? "Checking environment..." : "Checking environment..."}
              </button>
            ) : wslCheck.ok ? (
              <button style={styles.launchBtn} onClick={handleLaunch} disabled={loading}>
                {loading ? "Launching..." : "Launch Mission"}
              </button>
            ) : (
              <div style={styles.wslBarrier}>
                <div style={styles.wslBarrierTitle}>Cannot Launch — Environment Check Failed</div>
                <pre style={styles.wslBarrierDetail}>{wslCheck.message}</pre>
                <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>
                  Launch requires WSL 2 + ROS2 Humble + Gazebo inside WSL.
                  See the project README for setup instructions.
                </div>
              </div>
            )
          ) : (
            <div style={styles.actionRow}>
              <button style={styles.acceptBtn} onClick={handleAccept} disabled={loading || phase === "generating"}>
                {loading ? "Generating..." : "Accept Plan"}
              </button>
              <button style={styles.reviseBtn}
                onClick={() => setShowCorrection(!showCorrection)}
                disabled={loading || correctionsRemaining <= 0}>
                Revise Plan
              </button>
            </div>
          )}
        </div>
        {showCorrection && (
          <div style={styles.correctionArea}>
            <textarea style={styles.correctionInput} placeholder="What should change?"
              rows={2} value={correctionText} onChange={(e) => setCorrectionText(e.target.value)} />
            <div style={styles.correctionActions}>
              <button style={styles.sendRevBtn} onClick={handleRevise}>Send Revision</button>
              <button style={styles.cancelBtn} onClick={() => setShowCorrection(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPlan(plan: Record<string, unknown> | null): string {
  if (!plan) return "No plan generated.";

  const parts: string[] = [];

  // Start with human summary if available
  const humanSummary = plan.human_summary as string | undefined;
  if (humanSummary) {
    parts.push(humanSummary);
    parts.push("");
  }

  // Robot assignments in plain language
  const assignments = plan.robot_assignments as Array<Record<string, unknown>> | undefined;
  const flows = plan.flows as Array<Record<string, unknown>> | undefined;
  if (assignments && assignments.length > 0) {
    parts.push("Fleet assignments:");
    assignments.forEach((a) => {
      const flow = flows?.find((f) => f.id === a.flow_id);
      const taskCount = (flow?.tasks as Array<unknown>)?.length || 0;
      const flowLabel = (flow?.description as string) || a.flow_id;
      parts.push(`  • ${a.robot_id} — ${flowLabel} (${taskCount} step${taskCount !== 1 ? "s" : ""})`);
    });
    parts.push("");
  }

  // Step-by-step breakdown per robot
  if (flows && flows.length > 0) {
    parts.push("Step-by-step plan:");
    flows.forEach((flow, i) => {
      const tasks = (flow.tasks || []) as Array<Record<string, unknown>>;
      const duration = flow.estimated_duration_s || "?";
      parts.push(`\nFlow ${i + 1}: ${flow.description || "Untitled"} (~${Math.round(Number(duration) / 60)}min)`);
      tasks.forEach((t, j) => {
        const loc = String(t.location || "?");
        const action = String(t.action || t.action_type || "");
        const actionLabel = action ? ` (${action})` : "";
        parts.push(`  ${j + 1}. Go to ${loc}${actionLabel}`);
      });
    });
  } else {
    parts.push("Plan received. Review the map to the right.");
  }

  // Summary stats
  const totalDuration = plan.estimated_total_duration_s || "?";
  const taskCount = flows?.reduce((sum, f) => sum + ((f.tasks as Array<unknown>)?.length || 0), 0) || 0;
  parts.push(`\n${flows?.length || 0} flows · ${taskCount} steps · ~${Math.round(Number(totalDuration) / 60)} minutes total`);

  const notes = plan.notes as string | undefined;
  if (notes) parts.push(`\nNote: ${notes}`);

  return parts.join("\n");
}

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, display: "flex", overflow: "hidden", background: colors.surface.default },

  // ── Chat Panel ──
  chatPanel: { width: "38%", minWidth: 300, display: "flex", flexDirection: "column", borderRight: `1px solid ${colors.border.default}` },
  chatHeader: {
    padding: "12px 20px", borderBottom: `1px solid ${colors.border.default}`,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  chatTitle: { fontSize: 14, fontWeight: 600, color: colors.text.primary },
  newBtn: {
    background: "transparent", color: colors.primary, border: `1px solid ${colors.border.default}`,
    borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer",
  },

  // ── Messages ──
  messages: { flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 },
  placeholder: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 8, marginTop: -40 },
  placeholderIcon: { opacity: 0.3, marginBottom: 4 },
  placeholderTitle: { fontSize: 15, fontWeight: 600, color: colors.text.muted },
  placeholderHint: { fontSize: 12, color: colors.text.faint },

  bubble: { borderRadius: 12, fontSize: 13, lineHeight: 1.6, maxWidth: "85%", padding: "10px 14px" },
  bubbleUser: {
    background: colors.primary,
    color: colors.primaryForeground,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    background: colors.surface.subtle,
    color: colors.text.primary,
    border: `1px solid ${colors.border.default}`,
    borderBottomLeftRadius: 4,
  },
  bubbleRole: { fontSize: 10, fontWeight: 600, color: colors.primary, textTransform: "uppercase" as const, letterSpacing: "0.5px", display: "block", marginBottom: 4 },
  bubbleContent: {},

  typing: { display: "flex", gap: 4, padding: "4px 0" },
  typingDot: {
    width: 6, height: 6, borderRadius: "50%", background: colors.text.faint,
    animation: "pulse 1.2s ease-in-out infinite",
  },

  // ── Input ──
  inputArea: {
    padding: "12px 16px", borderTop: `1px solid ${colors.border.default}`,
    background: colors.surface.subtle,
  },
  inputRow: { display: "flex", gap: 8, alignItems: "flex-end" },
  textInput: {
    flex: 1, background: colors.surface.default, color: colors.text.primary,
    border: `1px solid ${colors.border.default}`, borderRadius: 8,
    padding: "10px 12px", fontSize: 13, resize: "none", outline: "none",
    fontFamily: "inherit",
  },
  sendBtn: {
    background: colors.primary, color: colors.primaryForeground, border: "none",
    borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap", transition: "opacity 0.15s",
  },
  llmWarning: {
    background: colors.dangerBg, color: colors.danger,
    border: `1px solid ${colors.dangerBorder}`, borderRadius: 6,
    padding: "8px 12px", fontSize: 12, fontWeight: 500, marginBottom: 8,
  },

  // ── Plan Panel ──
  planPanel: { flex: 1, display: "flex", flexDirection: "column" },
  planHeader: {
    padding: "12px 20px", borderBottom: `1px solid ${colors.border.default}`,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  planTitle: { fontSize: 14, fontWeight: 600, color: colors.text.primary },
  correctionBadge: { fontSize: 11, fontWeight: 500, color: colors.warning },

  mapContainer: {
    flex: 1, margin: 12, borderRadius: 8,
    border: `1px solid ${colors.border.default}`, overflow: "hidden",
  },

  emptyState: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 10, margin: 16,
  },
  emptyIcon: { opacity: 0.4, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: colors.text.muted },
  emptyHint: { fontSize: 12, color: colors.text.faint, textAlign: "center", maxWidth: 300, lineHeight: 1.5 },

  controls: {
    display: "flex", flexDirection: "column", gap: 8,
    padding: "12px 16px", borderTop: `1px solid ${colors.border.default}`,
    background: colors.surface.subtle,
  },
  actionRow: { display: "flex", gap: 8 },
  acceptBtn: {
    flex: 1, background: colors.primary, color: colors.primaryForeground,
    border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  reviseBtn: {
    flex: 1, background: colors.secondary, color: colors.secondaryForeground,
    border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  launchBtn: {
    flex: 1, background: colors.primary, color: colors.primaryForeground,
    border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  correctionArea: {
    padding: "12px 16px", borderTop: `1px solid ${colors.border.default}`,
    display: "flex", flexDirection: "column", gap: 8, background: colors.surface.subtle,
  },
  correctionInput: {
    background: colors.surface.default, color: colors.text.primary,
    border: `1px solid ${colors.border.default}`, borderRadius: 8,
    padding: "10px 12px", fontSize: 13, resize: "none", outline: "none",
    fontFamily: "inherit",
  },
  correctionActions: { display: "flex", gap: 8 },
  sendRevBtn: {
    background: colors.secondary, color: colors.secondaryForeground,
    border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  cancelBtn: {
    background: "transparent", color: colors.text.muted,
    border: `1px solid ${colors.border.default}`, borderRadius: 6,
    padding: "8px 16px", fontSize: 13, cursor: "pointer",
  },
  wslBarrier: { background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}`, borderRadius: 8, padding: 12 },
  wslBarrierTitle: { color: colors.danger, fontSize: 13, fontWeight: 700, marginBottom: 6 },
  wslBarrierDetail: { color: colors.danger, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" as const, fontFamily: "monospace", margin: 0 },
};
