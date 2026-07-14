import { create } from "zustand";
import type { DAGSpec, MissionPhase } from "../types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface PlanStore {
  phase: MissionPhase;
  conversation: ChatMessage[];
  currentPlan: Record<string, unknown> | null;
  currentDag: DAGSpec | null;
  error: string | null;
  correctionsRemaining: number;
  setPhase: (p: MissionPhase) => void;
  addMessage: (msg: ChatMessage) => void;
  setPlan: (plan: Record<string, unknown>) => void;
  setDag: (dag: DAGSpec) => void;
  setError: (err: string | null) => void;
  setCorrectionsRemaining: (n: number) => void;
  reset: () => void;
}

export const usePlanStore = create<PlanStore>((set) => ({
  phase: "idle",
  conversation: [],
  currentPlan: null,
  currentDag: null,
  error: null,
  correctionsRemaining: 3,
  setPhase: (p) => set({ phase: p }),
  addMessage: (msg) =>
    set((s) => ({ conversation: [...s.conversation, msg] })),
  setPlan: (plan) => set({ currentPlan: plan }),
  setDag: (dag) => set({ currentDag: dag }),
  setError: (err) => set({ error: err }),
  setCorrectionsRemaining: (n) => set({ correctionsRemaining: n }),
  reset: () =>
    set({
      phase: "idle",
      conversation: [],
      currentPlan: null,
      currentDag: null,
      error: null,
      correctionsRemaining: 3,
    }),
}));
