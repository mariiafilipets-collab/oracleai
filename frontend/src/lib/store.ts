import { create } from "zustand";

interface AppState {
  contractAddresses: Record<string, string>;
  setContractAddresses: (addresses: Record<string, string>) => void;
  activityFeed: ActivityItem[];
  addActivity: (item: ActivityItem) => void;
}

export interface ActivityItem {
  address: string;
  amount: string;
  tier: string;
  tierKey?: string;
  points: number;
  streak: number;
  timestamp: number;
}

export const useAppStore = create<AppState>((set) => ({
  contractAddresses: {},
  setContractAddresses: (addresses) => set({ contractAddresses: addresses }),
  activityFeed: [],
  addActivity: (item) =>
    set((state) => ({
      activityFeed: [item, ...state.activityFeed].slice(0, 50),
    })),
}));
