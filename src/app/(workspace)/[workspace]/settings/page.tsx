"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_COLORS } from "@/lib/channel-categories";

type CategoryRow = {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  color: string | null;
};

export default function SettingsPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [catError, setCatError] = useState("");

  // ワークスペースID取得
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", params.workspace)
        .maybeSingle();
      if (data) setWorkspaceId(data.id);
    })();
  }, [params.workspace, supabase]);

  // カテゴリ一覧取得
  const fetchCategories = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("workspace_categories")
      .select("id, slug, label, sort_order, color")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: true });
    setCategories((data || []) as CategoryRow[]);
  }, [workspaceId, supabase]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // カテゴリ追加
  async function handleAdd() {
    if (!workspaceId || !newLabel.trim() || adding) return;
    setAdding(true);
    setCatError("");
    const { error } = await supabase.rpc("add_workspace_category", {
      p_workspace_id: workspaceId,
      p_label: newLabel.trim(),
      p_color: newColor,
    });
    if (error) {
      setCatError(error.message);
    } else {
      setNewLabel("");
      setNewColor(null);
      await fetchCategories();
    }
    setAdding(false);
  }

  // カテゴリの色変更 (null = 無色)
  async function handleColorChange(slug: string, color: string | null) {
    if (!workspaceId) return;
    setCatError("");
    // 楽観的更新
    setCategories((prev) =>
      prev.map((c) => (c.slug === slug ? { ...c, color } : c))
    );
    const { error } = await supabase.rpc("update_workspace_category_color", {
      p_workspace_id: workspaceId,
      p_slug: slug,
      p_color: color,
    });
    if (error) {
      setCatError(error.message);
      await fetchCategories();
    }
  }

  // カテゴリ削除
  async function handleDelete(slug: string, label: string) {
    if (!workspaceId) return;
    if (!confirm(`カテゴリ「${label}」を削除しますか？\n該当チャンネルは「その他」に移動します。`)) return;
    setCatError("");
    const { error } = await supabase.rpc("delete_workspace_category", {
      p_workspace_id: workspaceId,
      p_slug: slug,
    });
    if (error) {
      setCatError(error.message);
    } else {
      await fetchCategories();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="font-bold text-lg">設定</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-xl">
        {/* テーマ設定 */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">テーマ</h2>
          <ThemeSelector />
        </section>

        {/* カテゴリ管理 */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">チャンネルカテゴリ</h2>
          <p className="text-xs text-muted mb-3">
            サイドバーでチャンネルをグループ分けするカテゴリを管理できます。
          </p>

          {catError && (
            <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {catError}
            </div>
          )}

          {/* カテゴリ一覧 */}
          <div className="space-y-1 mb-3">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-border/50"
              >
                <span
                  className="text-sm flex-1 truncate font-medium"
                  style={{ color: cat.color || undefined }}
                >
                  {cat.label}
                </span>
                {/* カラーピッカー: 無色 + 7色のドット */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleColorChange(cat.slug, null)}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      !cat.color
                        ? "border-foreground/60 ring-2 ring-foreground/30"
                        : "border-border hover:border-foreground/40"
                    }`}
                    title="無色"
                    aria-label="無色"
                  >
                    <svg className="w-full h-full text-muted" viewBox="0 0 20 20" fill="currentColor">
                      <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => handleColorChange(cat.slug, c.value)}
                      style={{ backgroundColor: c.value }}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        cat.color === c.value
                          ? "border-foreground/60 ring-2 ring-foreground/30 scale-110"
                          : "border-transparent hover:scale-110"
                      }`}
                      title={c.label}
                      aria-label={c.label}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(cat.slug, cat.label)}
                  className="shrink-0 ml-1 p-1 text-muted hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {categories.length === 0 && (
              <div className="text-xs text-muted py-2">カテゴリがありません</div>
            )}
          </div>

          {/* カテゴリ追加フォーム */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="新しいカテゴリ名"
                style={{ color: newColor || undefined }}
                className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newLabel.trim() || adding}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {adding ? "追加中..." : "追加"}
              </button>
            </div>
            {/* 新規カテゴリの色 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted mr-1">色</span>
              <button
                type="button"
                onClick={() => setNewColor(null)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  !newColor
                    ? "border-foreground/60 ring-2 ring-foreground/30"
                    : "border-border hover:border-foreground/40"
                }`}
                title="無色"
                aria-label="無色"
              >
                <svg className="w-full h-full text-muted" viewBox="0 0 20 20" fill="currentColor">
                  <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setNewColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    newColor === c.value
                      ? "border-foreground/60 ring-2 ring-foreground/30 scale-110"
                      : "border-transparent hover:scale-110"
                  }`}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ログアウト */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">アカウント</h2>
          <form action={signOut}>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
            >
              ログアウト
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
