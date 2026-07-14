import { create } from "zustand";

interface ConfigStore {
  robotCount: number;
  sessionId: string;
  mockMode: boolean;
  setRobotCount: (n: number) => void;
  setSessionId: (id: string) => void;
  setMockMode: (v: boolean) => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  robotCount: 3,
  sessionId: "",
  mockMode: false,
  setRobotCount: (n) => set({ robotCount: Math.max(1, Math.min(6, n)) }),
  setSessionId: (id) => set({ sessionId: id }),
  setMockMode: (v) => set({ mockMode: v }),
}));
