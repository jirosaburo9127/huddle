// ワークスペースごとに動的管理されるカテゴリ
// workspace_categories テーブルから取得したデータを扱う型とユーティリティ

export type WorkspaceCategory = {
  slug: string;
  label: string;
  sort_order: number;
};

export const UNCATEGORIZED_LABEL = "その他";
