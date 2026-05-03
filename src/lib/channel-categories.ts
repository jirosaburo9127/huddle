// ワークスペースごとに動的管理されるカテゴリ
// workspace_categories テーブルから取得したデータを扱う型とユーティリティ

export type WorkspaceCategory = {
  slug: string;
  label: string;
  sort_order: number;
  color?: string | null;
};

export const UNCATEGORIZED_LABEL = "その他";

// カテゴリに付けられる色のパレット (固定 7 色 + 無色)
// 文字色として使う想定なので、dark/light テーマ両方で読める中明度を選定。
export const CATEGORY_COLORS: { label: string; value: string }[] = [
  { label: "赤", value: "#ef4444" },
  { label: "橙", value: "#f59e0b" },
  { label: "黄", value: "#eab308" },
  { label: "緑", value: "#10b981" },
  { label: "青", value: "#3b82f6" },
  { label: "紫", value: "#8b5cf6" },
  { label: "灰", value: "#64748b" },
];
