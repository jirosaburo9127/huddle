"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

type DmItem = {
  slug: string;
  otherName: string;
  otherAvatar: string | null;
  isOnline: boolean;
  lastMessage: string | null;
  lastAt: string | null;
};

export default function DmListPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const [items, setItems] = useState<DmItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", params.workspace)
        .maybeSingle();
      if (!ws) { setLoading(false); return; }

      // DM チャンネル取得
      const { data: dms } = await supabase
        .from("channels")
        .select("id, slug, channel_members(user_id, profiles(display_name, avatar_url, last_seen_at))")
        .eq("workspace_id", ws.id)
        .eq("is_dm", true)
        .order("created_at", { ascending: false });

      if (!dms) { setLoading(false); return; }

      const result: DmItem[] = [];
      for (const dm of dms as Array<{ id: string; slug: string; channel_members: Array<{ user_id: string; profiles: { display_name: string; avatar_url: string | null; last_seen_at: string | null } | Array<{ display_name: string; avatar_url: string | null; last_seen_at: string | null }> }> | null }>) {
        const members = dm.channel_members || [];
        // 自分がメンバーか確認
        if (!members.some((m) => m.user_id === user.id)) continue;
        const other = members.find((m) => m.user_id !== user.id);
        const p = other?.profiles;
        const profile = Array.isArray(p) ? p[0] : p;
        const isOnline = profile?.last_seen_at
          ? Date.now() - new Date(profile.last_seen_at).getTime() < 5 * 60 * 1000
          : false;

        // 最新メッセージ
        const { data: lastMsg } = await supabase
          .from("messages")
          .select("content, created_at")
          .eq("channel_id", dm.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        result.push({
          slug: dm.slug,
          otherName: profile?.display_name || "DM",
          otherAvatar: profile?.avatar_url || null,
          isOnline,
          lastMessage: lastMsg?.content?.replace(/\s+/g, " ").trim().slice(0, 50) || null,
          lastAt: lastMsg?.created_at || null,
        });
      }

      // 最終メッセージが新しい順にソート
      result.sort((a, b) => {
        if (!a.lastAt) return 1;
        if (!b.lastAt) return -1;
        return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
      });

      setItems(result);
      setLoading(false);
    })();
  }, [params.workspace]);

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
        <h1 className="font-bold text-lg">ダイレクトメッセージ</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-16 text-muted">読み込み中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-muted">DMがありません</div>
        ) : (
          <div>
            {items.map((dm) => (
              <Link
                key={dm.slug}
                href={`/${params.workspace}/${dm.slug}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-white/[0.02] transition-colors"
              >
                <span className="relative shrink-0">
                  {dm.otherAvatar ? (
                    <img src={dm.otherAvatar} alt={dm.otherName} className="w-11 h-11 rounded-full object-cover" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-accent/20 flex items-center justify-center">
                      <span className="text-sm font-bold text-accent">{dm.otherName[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  {dm.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-online border-2 border-sidebar" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-foreground truncate">{dm.otherName}</div>
                  {dm.lastMessage && (
                    <div className="text-xs text-muted truncate mt-0.5">{dm.lastMessage}</div>
                  )}
                </div>
                {dm.lastAt && (
                  <span className="text-[11px] text-muted shrink-0">
                    {new Date(dm.lastAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
