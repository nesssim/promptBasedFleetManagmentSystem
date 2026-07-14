import { create } from "zustand";

interface ConfigStore {
  robotCount: number;
  sessionId: string;
  setRobotCount: (n: number) => void;
  setSessionId: (id: string) => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  robotCount: 3,
  sessionId: "",
  setRobotCount: (n) => set({ robotCount: Math.max(1, Math.min(6, n)) }),
  setSessionId: (id) => set({ sessionId: id }),
}));
