import { create } from "zustand";
import type { RobotState } from "../types";

interface FleetStore {
  robots: RobotState[];
  tasksCompleted: number;
  tasksTotal: number;
  missionTime: number;
  connected: boolean;
  setRobots: (robots: RobotState[]) => void;
  updateRobot: (id: string, update: Partial<RobotState>) => void;
  setStats: (completed: number, total: number, time: number) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  robots: [],
  tasksCompleted: 0,
  tasksTotal: 0,
  missionTime: 0,
  connected: false,
  setRobots: (robots) => set({ robots }),
  updateRobot: (id, update) =>
    set((s) => ({
      robots: s.robots.map((r) => (r.id === id ? { ...r, ...update } : r)),
    })),
  setStats: (completed, total, time) =>
    set({ tasksCompleted: completed, tasksTotal: total, missionTime: time }),
  setConnected: (connected) => set({ connected }),
  reset: () =>
    set({
      robots: [],
      tasksCompleted: 0,
      tasksTotal: 0,
      missionTime: 0,
      connected: false,
    }),
}));
