"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Activity = {
  reaction_id: string;
  emoji: string;
  reacted_at: string;
  reactor_id: string;
  reactor_name: string;
  reactor_avatar: string | null;
  message_id: string;
  message_content: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
};

type Props = {
  workspaceSlug: string;
  onClose: () => void;
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function previewContent(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0 && !l.startsWith("https://")) || "";
  return firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
}

export function ActivityModal({ workspaceSlug, onClose }: Props) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setLoading(false); return; }
      const { data } = await supabase.rpc("get_my_activities", {
        p_user_id: user.id,
        p_limit: 50,
      });
      if (cancelled) return;
      if (data && Array.isArray(data)) {
        setItems(data as Activity[]);
      }
      // 既読マーク
      await supabase.rpc("mark_activity_seen");
      // サイドバーにも「既読になったよ」を知らせてバッジを即消す
      window.dispatchEvent(new CustomEvent("huddle:activitySeen"));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-sidebar border border-border shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
          <h3 className="text-base font-bold text-foreground">アクティビティ</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground rounded transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar">
          {loading ? (
            <div className="text-center py-10 text-sm text-muted">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted px-6">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              まだアクティビティはありません
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {items.map((a) => (
                <li key={a.reaction_id}>
                  <Link
                    href={`/${workspaceSlug}/${a.channel_slug}?m=${a.message_id}`}
                    onClick={onClose}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                  >
                    {a.reactor_avatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={a.reactor_avatar}
                        alt={a.reactor_name}
                        className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-accent">{(a.reactor_name || "?")[0]?.toUpperCase()}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">{a.reactor_name}</span>
                        <span className="text-sm">
                          が
                          {a.emoji.length <= 2 ? (
                            <span className="mx-1 text-base">{a.emoji}</span>
                          ) : (
                            <span className="mx-1 text-xs font-medium text-accent">「{a.emoji}」</span>
                          )}
                          でリアクション
                        </span>
                      </div>
                      <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
                        <span className="shrink-0">#{a.channel_name}</span>
                        <span>·</span>
                        <span className="shrink-0">{formatRelative(a.reacted_at)}</span>
                      </div>
                      <div className="text-xs text-muted mt-1 truncate">
                        {previewContent(a.message_content)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
