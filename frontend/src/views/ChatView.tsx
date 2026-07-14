import { useState, useRef, useEffect, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { usePlanStore } from "../stores/plan";
import { useConfigStore } from "../stores/config";
import { postPlan, postCorrect, postGenerate, postLaunch } from "../api";
import { YardMap } from "../components/YardMap";

/**
 * View 2: Chat + Plan Visualizer
 * Jenkins-inspired design — log-style panels, slate palette, structured controls.
 *
 * NO static/fake data is ever shown. The YardMap only renders when
 * a real DAG with actual locations exists. In mock mode (no LLM key),
 * the user sees status messages but no fake zones or fake robots.
 */
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
  const robotCount = useConfigStore((s) => s.robotCount);
  const sessionId = useConfigStore((s) => s.sessionId);
  const mockMode = useConfigStore((s) => s.mockMode);

  const [missionText, setMissionText] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [loading, setLoading] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [conversation]);

  const hasRealDag = currentDag !== null && currentDag?.locations != null && Object.keys(currentDag.locations).length > 0;

  const handleSend = useCallback(async () => {
    if (!missionText.trim() || loading) return;
    setLoading(true);
    setError(null);
    addMessage({ role: "user", content: missionText, timestamp: Date.now() });
    try {
      const r = await postPlan(missionText, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setPhase(r.phase as any);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({
        role: "assistant",
        content: r.mock
          ? `[MOCK MODE] Mission "${missionText}" received. No LLM connected — connect an ANTHROPIC_API_KEY to generate a real plan. The YardMap will show locations once a real DAG is generated.`
          : formatPlan(r.plan),
        timestamp: Date.now(),
      });
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); setMissionText(""); }
  }, [missionText, loading, sessionId, addMessage, setPlan, setPhase, setCorrectionsRemaining, setError]);

  const handleRevise = useCallback(async () => {
    if (!correctionText.trim() || loading) return;
    setLoading(true);
    setError(null);
    setShowCorrection(false);
    addMessage({ role: "user", content: correctionText, timestamp: Date.now() });
    try {
      const r = await postCorrect(correctionText, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({
        role: "assistant",
        content: r.mock
          ? "[MOCK MODE] Correction noted. No LLM connected — no plan was updated."
          : formatPlan(r.plan),
        timestamp: Date.now(),
      });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setCorrectionText(""); }
  }, [correctionText, loading, sessionId, addMessage, setPlan, setCorrectionsRemaining, setError]);

  const handleAccept = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await postGenerate(sessionId);
      setDag(r.dag as any);
      setPhase(r.phase as any);
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
    } catch {
      console.warn("[launch] Failed to launch (expected in mock mode without Gazebo)");
    }
    setPhase("running");
    setLoading(false);
  }, [loading, sessionId, setError, setPhase]);

  return (
    <div style={S.container}>
      {/* Left — Chat */}
      <div style={S.chatPanel}>
        <div style={S.chatHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12v8H4l-2 2V3z" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
            </svg>
            <span style={S.chatTitle}>Mission Chat</span>
          </div>
          <button
            style={S.ghostBtn}
            onClick={() => { setPhase("idle"); usePlanStore.getState().reset(); }}
          >
            + New Mission
          </button>
        </div>

        <div style={S.messages}>
          {conversation.length === 0 && (
            <div style={S.placeholder}>
              Describe your mission to begin.
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                e.g. "Survey zone A and zone B, then charge"
              </div>
            </div>
          )}
          {conversation.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div
                key={i}
                style={{
                  ...S.bubble,
                  borderLeft: isUser ? "4px solid #3b82f6" : "4px solid #16a34a",
                }}
              >
                <div style={S.bubbleRole}>{isUser ? "You" : "Planner"}</div>
                <div style={S.bubbleText}>{m.content}</div>
              </div>
            );
          })}
          <div ref={chatEnd} />
        </div>

        <div style={S.inputArea}>
          <textarea
            style={S.textInput}
            placeholder="Describe your mission..."
            rows={2}
            value={missionText}
            onChange={(e) => setMissionText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button style={S.sendBtn} onClick={handleSend} disabled={loading}>
              {loading ? "Sending..." : "Send"}
            </button>
            <span style={S.chip}>{robotCount} robots</span>
          </div>
        </div>
      </div>

      {/* Right — Plan Visualizer */}
      <div style={S.planPanel}>
        <div style={S.planHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1" stroke="#0f172a" strokeWidth="1.2" fill="none"/>
              <rect x="9" y="2" width="5" height="5" rx="1" stroke="#0f172a" strokeWidth="1.2" fill="none"/>
              <rect x="2" y="9" width="5" height="5" rx="1" stroke="#0f172a" strokeWidth="1.2" fill="none"/>
              <rect x="9" y="9" width="5" height="5" rx="1" stroke="#0f172a" strokeWidth="1.2" fill="none"/>
            </svg>
            <span style={S.planTitle}>Task Plan</span>
          </div>
          <span style={S.badge}>
            {correctionsRemaining} / 3 corrections
          </span>
        </div>

        <div style={S.mapArea}>
          {hasRealDag ? (
            <YardMap dag={currentDag} planned />
          ) : (
            <div style={S.emptyMap}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="6" y="12" width="36" height="22" rx="4" stroke="#94a3b8" strokeWidth="1.5" fill="none" strokeDasharray="4 2"/>
                <circle cx="18" cy="26" r="5" stroke="#94a3b8" strokeWidth="1.5" fill="none"/>
                <circle cx="30" cy="26" r="5" stroke="#94a3b8" strokeWidth="1.5" fill="none"/>
              </svg>
              <div style={S.emptyText}>
                {mockMode
                  ? "MOCK MODE — No real plan data. Connect ANTHROPIC_API_KEY to generate a mission DAG."
                  : "Send a mission description to generate a task plan."}
              </div>
            </div>
          )}
        </div>

        <div style={S.controls}>
          {phase === "dag_ready" ? (
            <button style={S.launchBtn} onClick={handleLaunch} disabled={loading}>
              {loading ? "Launching..." : "Launch Mission"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <button
                style={S.acceptBtn}
                onClick={handleAccept}
                disabled={loading || phase === "generating"}
              >
                {loading ? "Generating..." : "Accept Plan"}
              </button>
              <button
                style={{
                  ...S.reviseBtn,
                  opacity: loading || correctionsRemaining <= 0 ? 0.5 : 1,
                }}
                onClick={() => setShowCorrection(!showCorrection)}
                disabled={loading || correctionsRemaining <= 0}
              >
                Revise Plan
              </button>
            </div>
          )}
        </div>

        {showCorrection && (
          <div style={S.correctionArea}>
            <textarea
              style={S.correctionInput}
              placeholder="What should change?"
              rows={2}
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.sendRevBtn} onClick={handleRevise}>Send Revision</button>
              <button style={S.cancelBtn} onClick={() => setShowCorrection(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function formatPlan(plan: Record<string, unknown> | null): string {
  if (!plan) return "No plan generated.";
  const flows = plan.flows as Array<Record<string, unknown>> | undefined;
  if (!flows || flows.length === 0) return "Plan received. Review the map to the right.";
  return flows.map((f, i) =>
    `${i+1}. ${f.description || "Flow"} (${(f.tasks as Array<unknown>).length} tasks, ~${f.estimated_duration_s||"?"}s)`
  ).join("\n") + `\n\nTotal: ${flows.length} flows, ~${plan.estimated_total_duration_s||"?"}s`;
}

// ── Jenkins-Inspired Styles ──

const S: Record<string, React.CSSProperties> = {
  // ── Layout ──
  container: {
    flex: 1,
    display: "flex",
    gap: 16,
    padding: 16,
    background: "#f1f5f9",
    overflow: "hidden",
    fontFamily: "'Inter', system-ui, sans-serif",
  },

  // ── Left Panel — Chat ──
  chatPanel: {
    width: "38%",
    minWidth: 300,
    display: "flex",
    flexDirection: "column",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },

  chatHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#ffffff",
  },

  chatTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    letterSpacing: -0.2,
  },

  ghostBtn: {
    background: "transparent",
    color: "#64748b",
    border: "1px solid transparent",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },

  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },

  placeholder: {
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 80,
    fontSize: 14,
    fontWeight: 500,
  },

  bubble: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    maxWidth: "90%",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },

  bubbleRole: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },

  bubbleText: {
    color: "#0f172a",
    whiteSpace: "pre-wrap" as const,
  },

  inputArea: {
    padding: "12px 16px",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  textInput: {
    width: "100%",
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
    boxSizing: "border-box" as const,
  },

  sendBtn: {
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  chip: {
    background: "#f1f5f9",
    color: "#64748b",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },

  // ── Right Panel — Task Plan ──
  planPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },

  planHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#ffffff",
  },

  planTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    letterSpacing: -0.2,
  },

  badge: {
    background: "#f1f5f9",
    color: "#64748b",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 11,
    fontWeight: 600,
  },

  mapArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    margin: 12,
  },

  controls: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  acceptBtn: {
    flex: 1,
    background: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },

  reviseBtn: {
    flex: 1,
    background: "#d97706",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },

  launchBtn: {
    flex: 1,
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },

  correctionArea: {
    padding: "12px 16px",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "#f8fafc",
  },

  correctionInput: {
    width: "100%",
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
    boxSizing: "border-box" as const,
  },

  sendRevBtn: {
    background: "#d97706",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },

  cancelBtn: {
    background: "#ffffff",
    color: "#64748b",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },

  emptyMap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    border: "1px dashed #e2e8f0",
    borderRadius: 6,
    minHeight: 260,
  },

  emptyText: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 320,
    lineHeight: 1.5,
  },
};
