import { create } from "zustand";

interface UIStore {
  showHistory: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  showLocations: boolean;
  openLocations: () => void;
  closeLocations: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  showHistory: false,
  openHistory: () => set({ showHistory: true }),
  closeHistory: () => set({ showHistory: false }),
  showLocations: false,
  openLocations: () => set({ showLocations: true }),
  closeLocations: () => set({ showLocations: false }),
}));
