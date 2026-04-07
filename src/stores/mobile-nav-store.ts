import { create } from "zustand";

type MobileNavStore = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
};

// モバイルではサイドバーを最初に表示する
export const useMobileNavStore = create<MobileNavStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
