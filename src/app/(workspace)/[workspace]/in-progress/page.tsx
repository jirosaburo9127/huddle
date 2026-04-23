"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

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

export default function InProgressPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const [items, setItems] = useState<InProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  // チャンネルフィルタ: null = 全て
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

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
  const channelFacets = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const it of items) {
      if (!it.channel_id) continue;
      const existing = map.get(it.channel_id);
      if (existing) existing.count += 1;
      else map.set(it.channel_id, { id: it.channel_id, name: it.channel_name, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!selectedChannelId) return items;
    return items.filter((it) => it.channel_id === selectedChannelId);
  }, [items, selectedChannelId]);

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
      </header>

      <div className="flex-1 overflow-y-auto p-6 hide-scrollbar">
        <div className="max-w-3xl mx-auto">
          {/* チャンネルタブ（ファイルタブ型 / 角丸上+下線ベース） */}
          {!loading && channelFacets.length > 0 && (
            <div className="flex items-end gap-1 mb-4 border-b border-border overflow-x-auto -mx-1 px-1">
              <button
                type="button"
                onClick={() => setSelectedChannelId(null)}
                className={`shrink-0 px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 -mb-px transition-colors ${
                  selectedChannelId === null
                    ? "bg-accent text-white border-accent"
                    : "bg-white/[0.03] text-muted hover:text-foreground hover:bg-white/[0.08] border-border"
                }`}
              >
                全て（{items.length}）
              </button>
              {channelFacets.map((ch) => {
                const active = selectedChannelId === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedChannelId(ch.id)}
                    className={`shrink-0 px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 -mb-px transition-colors ${
                      active
                        ? "bg-accent text-white border-accent"
                        : "bg-white/[0.03] text-muted hover:text-foreground hover:bg-white/[0.08] border-border"
                    }`}
                  >
                    #{ch.name}（{ch.count}）
                  </button>
                );
              })}
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
              <Link
                key={item.id}
                href={`/${params.workspace}/${item.channel_slug}?m=${item.id}`}
                className="block px-4 py-3 rounded-xl bg-blue-400/[0.06] border border-blue-400/20 hover:bg-blue-400/[0.1] transition-colors"
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
            ))
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
