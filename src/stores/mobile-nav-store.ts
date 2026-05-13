import { create } from "zustand";

type MobileNavStore = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  pendingDetailOpen: boolean;
  setPendingDetailOpen: (pending: boolean) => void;
  // メッセージ入力欄にフォーカスがある時 true。
  // ボトムタブバーがキーボードと一緒に画面を狭めないよう非表示化するために使う。
  messageInputFocused: boolean;
  setMessageInputFocused: (focused: boolean) => void;
};

// モバイルではサイドバーを最初に表示する
export const useMobileNavStore = create<MobileNavStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  pendingDetailOpen: false,
  setPendingDetailOpen: (pending) => set({ pendingDetailOpen: pending }),
  messageInputFocused: false,
  setMessageInputFocused: (focused) => set({ messageInputFocused: focused }),
}));
