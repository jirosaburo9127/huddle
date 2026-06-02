"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import { CreateDmModal } from "@/components/create-dm-modal";

type DmItem = {
  slug: string;
  channelId: string;
  otherName: string;
  otherAvatar: string | null;
  isOnline: boolean;
  lastMessage: string | null;
  lastAt: string | null;
  unreadCount: number;
};

type WsMember = {
  user_id: string;
  profiles: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    status: string | null;
  };
};

export default function DmListPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  useEffect(() => { setSidebarOpen(false); }, [setSidebarOpen]);
  const params = useParams<{ workspace: string }>();
  const [items, setItems] = useState<DmItem[]>([]);
  const [loading, setLoading] = useState(true);
  // 新規DM作成モーダル用
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<WsMember[]>([]);
  const [showCreateDm, setShowCreateDm] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setCurrentUserId(user.id);

        const { data: ws } = await supabase
          .from("workspaces")
          .select("id")
          .eq("slug", params.workspace)
          .maybeSingle();
        if (!ws) return;
        setWorkspaceId(ws.id);

        // 新規DM 作成モーダル用のワークスペースメンバー一覧
        const { data: wsMembers, error: wsMembersError } = await supabase
          .from("workspace_members")
          .select("user_id, profiles(id, display_name, avatar_url, status)")
          .eq("workspace_id", ws.id);
        if (wsMembersError) {
          // RLS/権限/ネットワーク失敗時に空状態と区別できないと困るので最低限ログに出す
          console.error("[dm-list] workspace_members 取得失敗", wsMembersError);
        }
        if (wsMembers) {
          // profiles は relation で 1:1 だが、Supabase の型が単数/配列ゆらぐので吸収
          // 配列で空配列のケースもあり得るので [0] が undefined にならないようガードする
          const normalized: WsMember[] = (wsMembers as Array<{
            user_id: string;
            profiles:
              | { id: string; display_name: string; avatar_url: string | null; status: string | null }
              | Array<{ id: string; display_name: string; avatar_url: string | null; status: string | null }>
              | null;
          }>)
            .map((m) => {
              const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              if (!profile) return null;
              return { user_id: m.user_id, profiles: profile };
            })
            .filter((m): m is WsMember => m !== null);
          setMembers(normalized);
        }

        // DM チャンネル取得
        const { data: dms } = await supabase
          .from("channels")
          .select("id, slug, channel_members(user_id, profiles(display_name, avatar_url, last_seen_at))")
          .eq("workspace_id", ws.id)
          .eq("is_dm", true)
          .order("created_at", { ascending: false });

        if (!dms) return;

        // 未読数を取得
        const { data: unreadData } = await supabase.rpc("get_unread_counts", {
          p_user_id: user.id,
        });
        const unreadMap = new Map<string, number>();
        if (unreadData && Array.isArray(unreadData)) {
          for (const row of unreadData as Array<{ channel_id: string; unread_count: number }>) {
            unreadMap.set(row.channel_id, Number(row.unread_count));
          }
        }

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
            channelId: dm.id,
            otherName: profile?.display_name || "DM",
            otherAvatar: profile?.avatar_url || null,
            isOnline,
            lastMessage: lastMsg?.content?.replace(/\s+/g, " ").trim().slice(0, 50) || null,
            lastAt: lastMsg?.created_at || null,
            unreadCount: unreadMap.get(dm.id) || 0,
          });
        }

        // 最終メッセージが新しい順にソート
        result.sort((a, b) => {
          if (!a.lastAt) return 1;
          if (!b.lastAt) return -1;
          return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
        });

        setItems(result);
      } finally {
        setLoading(false);
      }
    })();
  }, [params.workspace]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center py-3 bg-surface shrink-0" style={{ paddingLeft: "clamp(16px, 3vw, 40px)", paddingRight: "clamp(16px, 3vw, 40px)" }}>
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
        <h1 className="font-bold text-[18px] font-[720] flex-1">メッセージ</h1>
        <button
          type="button"
          onClick={() => setShowCreateDm(true)}
          disabled={!workspaceId || !currentUserId}
          className="ml-2 p-2 text-muted hover:text-foreground rounded-lg hover:bg-sidebar-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="新しいメッセージ"
          title="新しいメッセージ"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
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
                className="flex items-center gap-3 py-3 hover:bg-sidebar-hover transition-colors rounded-lg"
                style={{ paddingLeft: "clamp(16px, 3vw, 40px)", paddingRight: "clamp(16px, 3vw, 40px)" }}
              >
                <span className="relative shrink-0">
                  {dm.otherAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dm.otherAvatar} alt={dm.otherName} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-[15px] font-bold text-white">{dm.otherName[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  {dm.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-online border-2 border-surface" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[14px] truncate ${dm.unreadCount > 0 ? "font-bold text-foreground" : "font-[500] text-foreground"}`}>{dm.otherName}</span>
                    {dm.lastAt && (
                      <span className="text-[11px] text-muted shrink-0 ml-auto">
                        {new Date(dm.lastAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {dm.lastMessage && (
                      <span className={`text-[13px] truncate flex-1 ${dm.unreadCount > 0 ? "text-foreground font-semibold" : "text-muted font-normal"}`}>{dm.lastMessage}</span>
                    )}
                    {dm.unreadCount > 0 && (
                      <span className="shrink-0 w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                        {dm.unreadCount > 99 ? "99+" : dm.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 新規 DM 作成モーダル */}
      {showCreateDm && workspaceId && currentUserId && (
        <CreateDmModal
          workspaceId={workspaceId}
          workspaceSlug={params.workspace}
          currentUserId={currentUserId}
          members={members}
          onClose={() => setShowCreateDm(false)}
        />
      )}
    </div>
  );
}
