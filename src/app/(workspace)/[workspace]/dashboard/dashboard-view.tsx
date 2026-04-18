"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import {
  createShareToken,
  revokeShareToken,
} from "@/lib/actions/share-tokens";
import { generateDecisionsPdf, savePdf } from "@/lib/pdf-export";

// メッセージ本文が画像URLかを判定（Supabase Storage公開URLは拡張子で判別）
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
function isImageUrl(content: string): boolean {
  const trimmed = content.trim();
  if (!/^https?:\/\//.test(trimmed)) return false;
  return IMAGE_EXT_RE.test(trimmed);
}

type Decision = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  decision_why: string | null;
  decision_due: string | null;
};

type ShareToken = {
  id: string;
  token: string;
  label: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  last_accessed_at: string | null;
};

type Props = {
  workspace: { id: string; name: string; slug: string };
  workspaceSlug: string;
  decisions: Decision[];
  shareTokens: ShareToken[];
  isAdmin: boolean;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function DashboardView({
  workspace,
  workspaceSlug,
  decisions,
  shareTokens,
  isAdmin,
}: Props) {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);

  // マウント時: 決定事項を既読にしてサイドバーのバッジを 0 にする
  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("mark_decisions_read", { p_workspace_id: workspace.id })
      .then(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("huddle:decisionsRead"));
        }
      });
  }, [workspace.id]);

  const [newLabel, setNewLabel] = useState("");
  const [showShareSection, setShowShareSection] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState(shareTokens);
  // チャンネルフィルタ: null = 全て
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  // 期間フィルタ: null = 全期間
  type DateRange = "week" | "month" | null;
  const [dateRange, setDateRange] = useState<DateRange>(null);

  // 決定事項に登場するチャンネルをユニーク抽出（件数も集計）
  const channelFacets = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const d of decisions) {
      const existing = map.get(d.channel_id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(d.channel_id, {
          id: d.channel_id,
          name: d.channel_name,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [decisions]);

  const filteredDecisions = useMemo(() => {
    let list = decisions;
    if (selectedChannelId) {
      list = list.filter((d) => d.channel_id === selectedChannelId);
    }
    if (dateRange) {
      const now = Date.now();
      const threshold =
        dateRange === "week"
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;
      list = list.filter(
        (d) => new Date(d.created_at).getTime() >= threshold
      );
    }
    return list;
  }, [decisions, selectedChannelId, dateRange]);

  const selectedChannelName = selectedChannelId
    ? channelFacets.find((c) => c.id === selectedChannelId)?.name || ""
    : null;

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportPdf() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const rangeLabel =
        dateRange === "week" ? "今週" : dateRange === "month" ? "今月" : null;
      const bytes = await generateDecisionsPdf({
        workspaceName: workspace.name,
        selectedChannelName,
        rangeLabel,
        decisions: filteredDecisions.map((d) => ({
          id: d.id,
          content: d.content,
          created_at: d.created_at,
          channel_name: d.channel_name,
          sender_name: d.sender_name,
          decision_why: d.decision_why,
          decision_due: d.decision_due,
        })),
      });
      const dateStr = new Date().toISOString().slice(0, 10);
      const chSuffix = selectedChannelName ? `_${selectedChannelName}` : "";
      const rangeSuffix = dateRange === "week" ? "_week" : dateRange === "month" ? "_month" : "";
      const filename = `huddle_decisions_${workspace.slug}${chSuffix}${rangeSuffix}_${dateStr}.pdf`;
      await savePdf(bytes, filename);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[pdf-export] failed:", err);
      setExportError(
        err instanceof Error ? err.message : "PDF生成に失敗しました"
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleCreateToken() {
    if (!newLabel.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createShareToken(workspace.id, newLabel);
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.error || "作成に失敗しました");
      return;
    }
    setNewLabel("");
    // 画面をリロードしてトークン一覧を再取得（サーバー側revalidatePath済み）
    window.location.reload();
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm("この共有リンクを無効化しますか？")) return;
    const result = await revokeShareToken(tokenId, workspaceSlug);
    if (result.ok) {
      setTokens((prev) =>
        prev.map((t) => (t.id === tokenId ? { ...t, is_active: false } : t))
      );
    }
  }

  function copyShareUrl(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        {/* モバイル: サイドバーを開くボタン（元のチャンネルに戻るため） */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="サイドバーを開く"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="font-bold text-lg">決定事項</h1>
        <span className="ml-2 text-sm text-muted">{workspace.name}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* 決定事項一覧 */}
        <section className="print-area">
          {/* 印刷専用ヘッダー（画面には出さない） */}
          <div className="print-only" aria-hidden="true">
            <h1>{workspace.name} — 決定事項</h1>
            <div className="print-meta">
              {selectedChannelName ? `対象: #${selectedChannelName}` : "対象: 全チャンネル"}
              {" ／ "}
              {filteredDecisions.length}件
              {" ／ "}
              出力日:{" "}
              {new Date().toLocaleDateString("ja-JP", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <hr />
          </div>

          <div className="print:hidden flex items-baseline justify-between mb-3 gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              決定事項（最新100件）
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">
                {filteredDecisions.length}件
              </span>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredDecisions.length === 0 || exporting}
                className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                title={exporting ? "生成中..." : "現在の絞り込みで決定事項をPDFとして保存"}
              >
                {exporting ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                )}
                {exporting ? "生成中…" : "PDFエクスポート"}
              </button>
            </div>
          </div>

          {exportError && (
            <div className="print:hidden mb-3 text-xs text-mention bg-mention/10 border border-mention/30 rounded-lg px-3 py-2">
              PDF生成エラー: {exportError}
            </div>
          )}

          {/* 期間フィルタ */}
          <div className="print:hidden flex gap-2 mb-3 text-xs">
            {(
              [
                { key: null, label: "全期間" },
                { key: "week" as const, label: "今週" },
                { key: "month" as const, label: "今月" },
              ] as Array<{ key: DateRange; label: string }>
            ).map((opt) => {
              const active = dateRange === opt.key;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDateRange(opt.key)}
                  className={`px-3 py-1 rounded-lg border transition-colors ${
                    active
                      ? "bg-accent text-white border-accent"
                      : "border-border text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* チャンネルフィルタ（ピルバー・横スクロール可） */}
          {channelFacets.length > 0 && (
            <div className="print:hidden flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                type="button"
                onClick={() => setSelectedChannelId(null)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedChannelId === null
                    ? "bg-accent text-white border-accent"
                    : "border-border text-muted hover:text-foreground hover:bg-white/[0.04]"
                }`}
              >
                全て（{decisions.length}）
              </button>
              {channelFacets.map((ch) => {
                const active = selectedChannelId === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedChannelId(ch.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? "bg-accent text-white border-accent"
                        : "border-border text-muted hover:text-foreground hover:bg-white/[0.04]"
                    }`}
                  >
                    #{ch.name}（{ch.count}）
                  </button>
                );
              })}
            </div>
          )}

          {filteredDecisions.length === 0 ? (
            <div className="rounded-2xl border border-border bg-white/[0.02] p-8 text-center text-sm text-muted">
              {decisions.length === 0
                ? "まだ決定事項がありません。メッセージの「決定」ボタンを押すとここに集まります。"
                : "このチャンネルの決定事項はまだありません。"}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredDecisions.map((d) => (
                <Link
                  key={d.id}
                  href={`/${workspaceSlug}/${d.channel_slug}`}
                  className="print-card group block rounded-xl border border-border bg-surface hover:border-accent/40 hover:bg-accent/[0.04] transition-all"
                >
                  {/* 上部メタ: チャンネルバッジ + 日付 */}
                  <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 rounded-full px-2 py-0.5">
                      #{d.channel_name}
                    </span>
                    <span className="text-[11px] text-muted shrink-0">
                      {formatDate(d.created_at)}
                    </span>
                  </div>

                  {/* 本文 */}
                  <div className="px-4 pb-3">
                    {isImageUrl(d.content) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.content}
                        alt="添付画像"
                        className="max-h-72 rounded-lg border border-border object-contain"
                      />
                    ) : (
                      <div className="text-base leading-relaxed whitespace-pre-wrap break-words text-foreground">
                        {d.content}
                      </div>
                    )}
                  </div>

                  {/* Why / Due */}
                  {(d.decision_why || d.decision_due) && (
                    <div className="mx-4 mb-3 rounded-lg bg-background/40 border border-border/60 px-3 py-2 space-y-1.5 text-[13px]">
                      {d.decision_why && (
                        <div className="flex gap-2">
                          <span className="shrink-0 text-[10px] font-bold text-muted uppercase tracking-wider pt-0.5 w-8">
                            Why
                          </span>
                          <span className="flex-1 text-foreground/90 whitespace-pre-wrap break-words">
                            {d.decision_why}
                          </span>
                        </div>
                      )}
                      {d.decision_due && (
                        <div className="flex gap-2">
                          <span className="shrink-0 text-[10px] font-bold text-muted uppercase tracking-wider pt-0.5 w-8">
                            Due
                          </span>
                          <span className="flex-1 text-foreground/90 whitespace-pre-wrap break-words">
                            {d.decision_due}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* フッター: 送信者 */}
                  <div className="flex items-center gap-2 px-4 py-2 border-t border-border/40">
                    {d.sender_avatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={d.sender_avatar}
                        alt={d.sender_name}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                        {d.sender_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-[12px] text-muted">{d.sender_name}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 共有リンク管理（管理者のみ・最下部に折りたたみ表示） */}
        {isAdmin && (
          <section className="pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setShowShareSection((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-foreground transition-colors w-full text-left"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showShareSection ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              伴走マイスター向け共有リンク
              {tokens.length > 0 && (
                <span className="ml-1 text-xs text-muted">({tokens.length})</span>
              )}
            </button>

            {showShareSection && (
            <div className="mt-4">
            <p className="text-sm text-muted mb-4">
              このリンクを伴走マイスターに送ると、ログインなしで決定事項を閲覧できます。
              いつでも無効化できます。
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="例: 田中先生用"
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-transparent text-foreground placeholder:text-muted"
              />
              <button
                type="button"
                onClick={handleCreateToken}
                disabled={creating || !newLabel.trim()}
                className="px-4 py-2 text-sm rounded-xl bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                {creating ? "作成中..." : "共有リンク発行"}
              </button>
            </div>
            {createError && (
              <div className="text-sm text-mention mb-3">{createError}</div>
            )}

            <div className="space-y-2">
              {tokens.length === 0 && (
                <div className="text-sm text-muted text-center py-6">
                  まだ共有リンクがありません
                </div>
              )}
              {tokens.map((t) => {
                const shareUrl =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/share/${t.token}`
                    : `/share/${t.token}`;
                const expired = new Date(t.expires_at).getTime() < Date.now();
                const active = t.is_active && !expired;
                return (
                  <div
                    key={t.id}
                    className="rounded-xl border border-border bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">
                          {t.label}
                          {!active && (
                            <span className="ml-2 text-xs text-mention">
                              無効
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted truncate mt-0.5">
                          {shareUrl}
                        </div>
                        <div className="text-xs text-muted mt-1">
                          有効期限: {formatDateOnly(t.expires_at)}
                          {t.last_accessed_at && (
                            <>
                              {" ・ "}最終閲覧:{" "}
                              {formatDate(t.last_accessed_at)}
                            </>
                          )}
                        </div>
                      </div>
                      {active && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyShareUrl(t.token)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-white/[0.04] transition-colors"
                          >
                            {copiedToken === t.token ? "コピー済み" : "コピー"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(t.id)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
                          >
                            無効化
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
            )}
          </section>
        )}
        </div>
      </div>
    </div>
  );
}
