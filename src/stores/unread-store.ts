import { create } from "zustand";

// サイドバーが管理している未読カウントを他コンポーネント (BottomTabBar 等) から
// 参照するためのストア。サイドバーが書き手、それ以外は読み手。
type UnreadStore = {
  // ワークスペース内の DM チャンネル全体の未読件数合計
  // 「その他」ボタンと中の DM アイコンにバッジ表示するのに使う
  dmUnreadCount: number;
  setDmUnreadCount: (count: number) => void;
};

export const useUnreadStore = create<UnreadStore>((set) => ({
  dmUnreadCount: 0,
  setDmUnreadCount: (count) => set({ dmUnreadCount: count }),
}));
