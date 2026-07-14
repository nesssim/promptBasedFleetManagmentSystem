import { useState, useRef, useEffect } from "react";
import { usePlanStore } from "../stores/plan";
import { useConfigStore } from "../stores/config";
import { postPlan, postCorrect, postGenerate } from "../api";
import { YardMap } from "../components/YardMap";

/**
 * View 2: Chat + Plan Visualizer
 * Light theme — white backgrounds, subtle borders, clean typography.
 */
export function ChatView() {
  const phase = usePlanStore((s) => s.phase);
  const conversation = usePlanStore((s) => s.conversation);
  const currentPlan = usePlanStore((s) => s.currentPlan);
  const currentDag = usePlanStore((s) => s.currentDag);
  const correctionsRemaining = usePlanStore((s) => s.correctionsRemaining);
  const addMessage = usePlanStore((s) => s.addMessage);
  const setPlan = usePlanStore((s) => s.setPlan);
  const setDag = usePlanStore((s) => s.setDag);
  const setPhase = usePlanStore((s) => s.setPhase);
  const setError = usePlanStore((s) => s.setError);
  const robotCount = useConfigStore((s) => s.robotCount);
  const sessionId = useConfigStore((s) => s.sessionId);
  const setCorrectionsRemaining = usePlanStore((s) => s.setCorrectionsRemaining);

  const [missionText, setMissionText] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [loading, setLoading] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [conversation]);

  const planLocs = currentPlan?.flows ? extractLocs(currentPlan) : undefined;

  const handleSend = async () => {
    if (!missionText.trim() || loading) return;
    setLoading(true);
    setError(null);
    addMessage({ role: "user", content: missionText, timestamp: Date.now() });
    try {
      const r = await postPlan(missionText, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setPhase(r.phase as any);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({ role: "assistant", content: formatPlan(r.plan), timestamp: Date.now() });
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); setMissionText(""); }
  };

  const handleRevise = async () => {
    if (!correctionText.trim() || loading) return;
    setLoading(true);
    setError(null);
    setShowCorrection(false);
    addMessage({ role: "user", content: correctionText, timestamp: Date.now() });
    try {
      const r = await postCorrect(correctionText, sessionId);
      setPlan(r.plan as Record<string, unknown>);
      setCorrectionsRemaining(r.corrections_remaining);
      addMessage({ role: "assistant", content: formatPlan(r.plan), timestamp: Date.now() });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setCorrectionText(""); }
  };

  const handleAccept = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await postGenerate(sessionId);
      setDag(r.dag as any);
      setPhase("running");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const isGenerating = phase === "generating";

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
              Describe your mission to begin.
              <div style={{ color: "#a0aec0", fontSize: 12, marginTop: 4 }}>
                e.g. "Survey zone A and zone B, then charge"
              </div>
            </div>
          )}
          {conversation.map((m, i) => (
            <div key={i} style={{ ...styles.bubble, alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "#ebf4ff" : "#f8f9fa",
              color: m.role === "user" ? "#2b6cb0" : "#1a202c",
              borderBottomRightRadius: m.role === "user" ? 4 : 10,
              borderBottomLeftRadius: m.role === "assistant" ? 4 : 10,
              whiteSpace: "pre-wrap" as const,
            }}>
              {m.content}
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <div style={styles.inputArea}>
          <textarea style={styles.textInput} placeholder="Describe your mission..." rows={2}
            value={missionText}
            onChange={(e) => setMissionText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}} />
          <button style={styles.sendBtn} onClick={handleSend} disabled={loading}>Send</button>
          <span style={styles.chip}>{robotCount} robots</span>
        </div>
      </div>

      {/* Right — Plan Visualizer */}
      <div style={styles.planPanel}>
        <div style={styles.planHeader}>
          <span style={styles.planTitle}>Task Plan</span>
          {correctionsRemaining < 3 && (
            <span style={{ color: "#e88d3b", fontSize: 11 }}>{correctionsRemaining} corrections left</span>
          )}
        </div>
        <YardMap locations={planLocs} dag={currentDag} planned />
        <div style={styles.controls}>
          <button style={styles.acceptBtn} onClick={handleAccept} disabled={loading || !currentPlan}>
            {loading ? "Generating..." : "Accept Plan"}
          </button>
          <button style={styles.reviseBtn}
            onClick={() => setShowCorrection(!showCorrection)}
            disabled={loading || correctionsRemaining <= 0}>
            Revise Plan
          </button>
        </div>
        {showCorrection && (
          <div style={styles.correctionArea}>
            <textarea style={styles.correctionInput} placeholder="What should change?"
              rows={2} value={correctionText} onChange={(e) => setCorrectionText(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.sendRevBtn} onClick={handleRevise}>Send Revision</button>
              <button style={styles.cancelBtn} onClick={() => setShowCorrection(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function extractLocs(plan: Record<string, unknown>): Record<string, { x: number; y: number }> {
  const all: Record<string, { x: number; y: number }> = {
    dock_1:{x:-4,y:0}, dock_2:{x:-4,y:-2}, zone_A:{x:2,y:-3}, zone_B:{x:2,y:0},
    zone_C:{x:2,y:3}, zone_D:{x:6,y:-3}, zone_E:{x:6,y:0}, zone_F:{x:6,y:3},
    charging_station:{x:0,y:4}, weigh_station:{x:0,y:-4},
  };
  const used = new Set<string>();
  const flows = plan.flows as Array<Record<string, unknown>> | undefined;
  if (flows) for (const f of flows) {
    const tasks = f.tasks as Array<Record<string, unknown>> | undefined;
    if (tasks) for (const t of tasks) if (t.location) used.add(t.location as string);
  }
  const r: Record<string, { x: number; y: number }> = {};
  for (const n of used) if (all[n]) r[n] = all[n];
  return Object.keys(r).length > 0 ? r : all;
}

function formatPlan(plan: Record<string, unknown> | null): string {
  if (!plan) return "No plan generated.";
  const flows = plan.flows as Array<Record<string, unknown>> | undefined;
  if (!flows || flows.length === 0) return "Plan received. Review the map to the right.";
  return flows.map((f, i) =>
    `${i+1}. ${f.description || "Flow"} (${(f.tasks as Array<unknown>).length} tasks, ~${f.estimated_duration_s||"?"}s)`
  ).join("\n") + `\n\nTotal: ${flows.length} flows, ~${plan.estimated_total_duration_s||"?"}s`;
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, display: "flex", overflow: "hidden", background: "#ffffff" },
  chatPanel: { width: "38%", minWidth: 300, display: "flex", flexDirection: "column", borderRight: "1px solid #e2e8f0", background: "#ffffff" },
  chatHeader: { padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  chatTitle: { fontSize: 15, fontWeight: 700, color: "#1a202c" },
  newBtn: { background: "transparent", color: "#718096", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" },
  messages: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  placeholder: { color: "#a0aec0", textAlign: "center", marginTop: 60, fontSize: 14 },
  bubble: { padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.5, maxWidth: "85%" },
  inputArea: { padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, alignItems: "flex-end", background: "#f8f9fa" },
  textInput: { flex: 1, background: "#ffffff", color: "#1a202c", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontSize: 13, resize: "none", outline: "none" },
  sendBtn: { background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  chip: { background: "#f8f9fa", color: "#718096", border: "1px solid #e2e8f0", borderRadius: 12, padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" },
  planPanel: { flex: 1, display: "flex", flexDirection: "column", background: "#ffffff" },
  planHeader: { padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  planTitle: { fontSize: 15, fontWeight: 700, color: "#1a202c" },
  controls: { display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #e2e8f0", background: "#f8f9fa" },
  acceptBtn: { flex: 1, background: "#23a45d", color: "#fff", border: "none", borderRadius: 8, padding: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  reviseBtn: { flex: 1, background: "#e88d3b", color: "#fff", border: "none", borderRadius: 8, padding: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  correctionArea: { padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8, background: "#f8f9fa" },
  correctionInput: { background: "#ffffff", color: "#1a202c", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontSize: 13, resize: "none", outline: "none" },
  sendRevBtn: { background: "#e88d3b", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancelBtn: { background: "transparent", color: "#718096", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
};
