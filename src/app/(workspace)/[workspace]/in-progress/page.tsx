"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import {
  SortableChannelTabs,
  loadChannelOrder,
  saveChannelOrder,
  applyChannelOrder,
} from "@/components/sortable-channel-tabs";

type InProgressItem = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  sender_name: string;
  sender_avatar: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getAgeDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

function getAgeLabel(iso: string): string {
  const days = getAgeDays(iso);
  if (days === 0) return "今日";
  if (days === 1) return "1日経過";
  return `${days}日経過`;
}

export default function InProgressPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const [items, setItems] = useState<InProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  // 「完了にする」を 2 タップ確認方式にするための一時状態。
  // 1 タップ目で confirmingId にセット → 3 秒で自動解除。2 タップ目で実行。
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 失敗時の通知用。alert() はモバイル UX が悪いので画面内バナーで表示する。
  const [completionError, setCompletionError] = useState<string | null>(null);
  // チャンネルフィルタ: null = 全て
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  // モバイルのフィルタボトムシート開閉
  const [showFilter, setShowFilter] = useState(false);
  // ユーザー定義の並び順 (localStorage 保存)
  const orderScope = `in-progress:${params.workspace}`;
  const [channelOrder, setChannelOrder] = useState<string[]>(() =>
    loadChannelOrder(orderScope)
  );
  function handleReorder(newOrder: string[]) {
    setChannelOrder(newOrder);
    saveChannelOrder(orderScope, newOrder);
  }

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      // ワークスペースID取得
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", params.workspace)
        .maybeSingle();
      if (!ws) { setLoading(false); return; }

      const { data } = await supabase
        .from("messages")
        .select(
          "id, content, created_at, channels!inner(id, name, slug, workspace_id, is_dm), profiles!inner(display_name, avatar_url)"
        )
        .eq("status", "in_progress")
        .is("deleted_at", null)
        .eq("channels.workspace_id", ws.id)
        .eq("channels.is_dm", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (data) {
        setItems(
          data.map((row: { id: string; content: string; created_at: string; channels: unknown; profiles: unknown }) => {
            const ch = Array.isArray(row.channels) ? row.channels[0] : (row.channels as { id: string; name: string; slug: string });
            const p = Array.isArray(row.profiles) ? row.profiles[0] : (row.profiles as { display_name: string; avatar_url: string | null });
            return {
              id: row.id,
              content: row.content,
              created_at: row.created_at,
              channel_id: ch?.id || "",
              channel_name: ch?.name || "",
              channel_slug: ch?.slug || "",
              sender_name: p?.display_name || "メンバー",
              sender_avatar: p?.avatar_url || null,
            };
          })
        );
      }
      setLoading(false);
    })();
  }, [params.workspace]);

  // チャンネル別に集計（タブ表示用）
  // デフォルトは件数の多い順、ユーザーがドラッグで並び替えるとそれが優先される
  const channelFacets = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const it of items) {
      if (!it.channel_id) continue;
      const existing = map.get(it.channel_id);
      if (existing) existing.count += 1;
      else map.set(it.channel_id, { id: it.channel_id, name: it.channel_name, count: 1 });
    }
    const byCount = Array.from(map.values()).sort((a, b) => b.count - a.count);
    return applyChannelOrder(byCount, channelOrder);
  }, [items, channelOrder]);

  const filteredItems = useMemo(() => {
    if (!selectedChannelId) return items;
    return items.filter((it) => it.channel_id === selectedChannelId);
  }, [items, selectedChannelId]);

  const progressStats = useMemo(() => {
    const oldestDays = items.reduce((max, item) => Math.max(max, getAgeDays(item.created_at)), 0);
    const staleCount = items.filter((item) => getAgeDays(item.created_at) >= 7).length;
    return { oldestDays, staleCount };
  }, [items]);

  // 表示順の中で「最も古い 1 件」だけを最古マーカー対象にする。
  // 同日経過のカードが複数あったときに全部が「最古」表示になるのを防ぐ。
  const oldestItemId = useMemo(() => {
    if (filteredItems.length === 0) return null;
    let oldest = filteredItems[0];
    for (const item of filteredItems) {
      if (new Date(item.created_at).getTime() < new Date(oldest.created_at).getTime()) {
        oldest = item;
      }
    }
    return oldest.id;
  }, [filteredItems]);

  async function handleComplete(itemId: string) {
    if (completingId) return;

    // 1 タップ目: 確認状態にして 3 秒で自動解除する。誤タップ事故を防ぐ。
    if (confirmingId !== itemId) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmingId(itemId);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingId(null);
        confirmTimerRef.current = null;
      }, 3000);
      return;
    }

    // 2 タップ目: 実行
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmingId(null);
    setCompletingId(itemId);
    setCompletionError(null);

    const supabase = createClient();
    const { error } = await supabase.rpc("toggle_message_status", {
      p_message_id: itemId,
      p_status: "done",
    });
    setCompletingId(null);
    if (error) {
      setCompletionError("完了にできませんでした。もう一度お試しください。");
      // 4 秒で自動的に消す
      setTimeout(() => setCompletionError(null), 4000);
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  }

  // unmount 時にタイマーを片付ける
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
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
        <svg className="w-5 h-5 text-blue-400 mr-2" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <h1 className="font-bold text-lg">進行中</h1>
        {!loading && (
          <span className="ml-2 text-sm text-muted">{items.length}件</span>
        )}
      </header>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左サイド: 縦型チャンネルタブ (lg 以上) */}
        {!loading && channelFacets.length > 0 && (
          <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border overflow-y-auto hide-scrollbar p-2">
            <SortableChannelTabs
              items={channelFacets}
              selectedId={selectedChannelId}
              totalCount={items.length}
              onSelect={setSelectedChannelId}
              onReorder={handleReorder}
            />
          </aside>
        )}

        {/* 右側: 本文 */}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 pt-4 pb-6 hide-scrollbar">
          <div className="max-w-3xl mx-auto">
            {completionError && (
              <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300" role="alert">
                {completionError}
              </div>
            )}

            {!loading && items.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[11px] text-muted">進行中</div>
                  <div className="mt-0.5 text-lg font-bold text-foreground tabular-nums">
                    {items.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[11px] text-muted">チャンネル</div>
                  <div className="mt-0.5 text-lg font-bold text-foreground tabular-nums">
                    {channelFacets.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[11px] text-muted">7日以上</div>
                  <div className={`mt-0.5 text-lg font-bold tabular-nums ${
                    progressStats.staleCount > 0 ? "text-blue-400" : "text-foreground"
                  }`}>
                    {progressStats.staleCount}
                  </div>
                </div>
              </div>
            )}

            {/* モバイル用フィルタチップ (lg 未満で表示) */}
            {!loading && channelFacets.length > 0 && (
              <div className="lg:hidden mb-3">
                <button
                  type="button"
                  onClick={() => setShowFilter(true)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-border text-sm text-foreground hover:bg-white/[0.08] transition-colors max-w-full"
                >
                  <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span className="truncate">
                    {selectedChannelId
                      ? `#${channelFacets.find((c) => c.id === selectedChannelId)?.name ?? ""}`
                      : "全て"}
                  </span>
                  <span className="text-muted text-xs tabular-nums shrink-0">
                    {selectedChannelId
                      ? channelFacets.find((c) => c.id === selectedChannelId)?.count ?? 0
                      : items.length}
                  </span>
                  <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}
            <div className="space-y-3">
          {loading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p>進行中の項目はありません</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <p className="text-sm">このチャンネルの進行中項目はありません</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl bg-blue-400/[0.06] border border-blue-400/20 hover:bg-blue-400/[0.1] transition-colors"
              >
                <Link
                  href={`/${params.workspace}/${item.channel_slug}?m=${item.id}`}
                  className="block px-4 pt-3 pb-2"
                >
                  <div className="flex items-start gap-3">
                    {item.sender_avatar ? (
                      <img src={item.sender_avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-400/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-blue-400">{item.sender_name[0]?.toUpperCase()}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">{item.sender_name.length > 10 ? item.sender_name.slice(0, 10) + "…" : item.sender_name}</span>
                        <span className="text-xs text-muted shrink-0">{formatDate(item.created_at)}</span>
                        <span className="text-xs text-muted truncate max-w-[10em]">#{item.channel_name.length > 10 ? item.channel_name.slice(0, 10) + "…" : item.channel_name}</span>
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3">
                        {item.content}
                      </div>
                    </div>
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-2 border-t border-blue-400/15 px-4 py-2">
                  <span className={`text-[11px] font-medium ${
                    getAgeDays(item.created_at) >= 7 ? "text-blue-300" : "text-muted"
                  }`}>
                    {getAgeLabel(item.created_at)}
                    {item.id === oldestItemId && progressStats.oldestDays > 0 ? " ・最古" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleComplete(item.id)}
                    disabled={!!completingId}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                      confirmingId === item.id
                        ? "border-blue-400 bg-blue-400/15 text-blue-200"
                        : "border-blue-400/30 text-blue-300 hover:bg-blue-400/10"
                    }`}
                  >
                    {completingId === item.id
                      ? "更新中..."
                      : confirmingId === item.id
                        ? "もう一度押すと完了"
                        : "完了にする"}
                  </button>
                </div>
              </div>
            ))
          )}
            </div>
          </div>
        </div>
      </div>

      {/* モバイル用フィルタボトムシート */}
      {showFilter && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/40 flex items-end animate-fade-in"
          onClick={() => setShowFilter(false)}
        >
          <div
            className="w-full bg-sidebar rounded-t-2xl max-h-[70vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">チャンネルで絞り込み</h3>
                <p className="text-[11px] text-muted mt-0.5">行を長押しで並び替え</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFilter(false)}
                className="text-muted hover:text-foreground transition-colors"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <SortableChannelTabs
                items={channelFacets}
                selectedId={selectedChannelId}
                totalCount={items.length}
                onSelect={(id) => {
                  setSelectedChannelId(id);
                  setShowFilter(false);
                }}
                onReorder={handleReorder}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
