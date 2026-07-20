import { create } from "zustand";

const STORAGE_KEY = "missionswarm_session";

interface ConfigStore {
  robotCount: number;
  sessionId: string;
  mockMode: boolean;
  provider: string; // "claude" | "gemini" | "local" | "mock"
  llmReachable: boolean;
  llmError: string | null;
  llmModel: string | null;
  setRobotCount: (n: number) => void;
  setSessionId: (id: string) => void;
  setMockMode: (v: boolean) => void;
  setProvider: (v: string) => void;
  setLlmStatus: (reachable: boolean, error: string | null, model: string | null) => void;
  clearSession: () => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  robotCount: 3,
  sessionId: localStorage.getItem(STORAGE_KEY) || "",
  mockMode: false,
  provider: "mock",
  llmReachable: false,
  llmError: null,
  llmModel: null,
  setRobotCount: (n) => set({ robotCount: Math.max(1, Math.min(6, n)) }),
  setSessionId: (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ sessionId: id });
  },
  setMockMode: (v) => set({ mockMode: v }),
  setProvider: (v) => set({ provider: v }),
  setLlmStatus: (reachable, error, model) => set({ llmReachable: reachable, llmError: error, llmModel: model }),
  clearSession: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ sessionId: "" });
  },
}));
