import type { ChannelCategory } from "./supabase/types";

// サイドバー表示順 (上から下へ)
export const CHANNEL_CATEGORIES: ChannelCategory[] = [
  "idea",
  "todo",
  "in_progress",
  "review",
  "archived",
];

export const CHANNEL_CATEGORY_LABELS: Record<ChannelCategory, string> = {
  idea: "アイデアメモ",
  todo: "未着手",
  in_progress: "進行中",
  review: "メンバー確認願",
  archived: "完了",
};

export const UNCATEGORIZED_LABEL = "その他";
