"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, Channel } from "@/lib/supabase/types";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { CreateDmModal } from "@/components/create-dm-modal";
import { InviteModal } from "@/components/invite-modal";
import { BookmarkModal } from "@/components/bookmark-modal";
import { WsMembersModal } from "@/components/ws-members-modal";
import { ThemeSelector } from "@/components/theme-selector";
import { MfaSetup } from "@/components/mfa-setup";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import { showMessageNotification } from "@/lib/notification";
import { setupPushNotifications, syncAppBadgeFromServer } from "@/lib/push-notifications";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import type { Message } from "@/lib/supabase/types";

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  status: string | null;
};

type WorkspaceMember = {
  user_id: string;
  profiles: MemberProfile | MemberProfile[];
};

type SidebarProps = {
  workspace: Workspace;
  channels: Channel[];
  dmChannels: Channel[];
  members: WorkspaceMember[];
  currentUserId: string;
  workspaceSlug: string;
  unreadCounts?: Record<string, number>;
  mutedChannelIds?: string[];
  allWorkspaces: Array<{ id: string; name: string; slug: string }>;
};

export function Sidebar({
  workspace,
  channels,
  dmChannels,
  members,
  currentUserId,
  workspaceSlug,
  unreadCounts = {},
  mutedChannelIds = [],
  allWorkspaces,
}: SidebarProps) {
  const pathname = usePathname();
  // 未読カウントをローカルstate化（Realtime+クリックで更新するため）
  // NOTE: prop → state のシンク useEffect は意図的に置いていない。
  // サーバーアクション等で親が revalidate されると unreadCounts の参照が
  // 毎回新しくなるため、シンクすると無限ループ（React error #185）を起こす。
  // WS切替時は layout が再マウントされるので初期値で十分。
  const [unreadState, setUnreadState] = useState<Record<string, number>>(unreadCounts);
  // ミュート中のチャンネルIDセット。channel-view側のトグルから CustomEvent で更新される
  const [mutedSet, setMutedSet] = useState<Set<string>>(() => new Set(mutedChannelIds));

  // channel-view のミュートトグルから発火される `huddle:muteChanged` を購読
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent<{ channelId: string; muted: boolean }>).detail;
      if (!detail) return;
      setMutedSet((prev) => {
        const next = new Set(prev);
        if (detail.muted) next.add(detail.channelId);
        else next.delete(detail.channelId);
        return next;
      });
      // ミュートにした場合はバッジ数も即時0に（解除時はRealtimeまたはfocusで再取得）
      if (detail.muted) {
        setUnreadState((prev) => {
          if (!(detail.channelId in prev)) return prev;
          const next = { ...prev };
          delete next[detail.channelId];
          return next;
        });
      }
    }
    window.addEventListener("huddle:muteChanged", handler as EventListener);
    return () => {
      window.removeEventListener("huddle:muteChanged", handler as EventListener);
    };
  }, []);
  // Sidebar専用のSupabaseクライアント（毎レンダー再生成しない）
  const sidebarSupabaseRef = useRef(createClient());
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateDm, setShowCreateDm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [showWsMembers, setShowWsMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWsSwitcher, setShowWsSwitcher] = useState(false);
  const wsSwitcherRef = useRef<HTMLDivElement>(null);
  // zustand セレクタ形式で購読範囲を限定（不要な再レンダーを防ぐ）
  const sidebarOpen = useMobileNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const [searchQuery, setSearchQuery] = useState("");

  // プロフィール編集用のstate
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileToast, setProfileToast] = useState(false);
  const [profileUploading, setProfileUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 設定モーダルが開いたらプロフィールを取得
  const loadProfile = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", currentUserId)
      .single();
    if (data) {
      setProfileDisplayName(data.display_name || "");
      setProfileAvatarUrl(data.avatar_url);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (showSettings) {
      loadProfile();
    }
  }, [showSettings, loadProfile]);

  // アバター画像アップロード処理
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "png";
      const path = `avatars/${currentUserId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("chat-files")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);
      setProfileAvatarUrl(urlData.publicUrl);
    } catch (err) {
      console.error("アバターアップロードエラー:", err);
    } finally {
      setProfileUploading(false);
      // inputをリセットして同じファイルも再選択可能にする
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  // プロフィール保存処理
  const handleProfileSave = async () => {
    if (!profileDisplayName.trim()) return;
    setProfileSaving(true);
    try {
      const supabase = createClient();
      await supabase
        .from("profiles")
        .update({
          display_name: profileDisplayName.trim(),
          avatar_url: profileAvatarUrl,
        })
        .eq("id", currentUserId);
      setProfileToast(true);
      setTimeout(() => setProfileToast(false), 2000);
    } catch (err) {
      console.error("プロフィール保存エラー:", err);
    } finally {
      setProfileSaving(false);
    }
  };

  // 現在開いているチャンネルのID（pathname → slug → channel）
  const currentChannelId = useMemo(() => {
    const slug = pathname.split("/")[2]; // /[workspace]/[channel]
    if (!slug) return null;
    const found = [...channels, ...dmChannels].find((c) => c.slug === slug);
    return found?.id ?? null;
  }, [pathname, channels, dmChannels]);

  // 表示中のチャンネルが切り替わったら未読をクリア + DB側 last_read_at を更新
  useEffect(() => {
    if (!currentChannelId) return;

    // 楽観的にバッジを消す
    setUnreadState((prev) => {
      if (!prev[currentChannelId]) return prev;
      const next = { ...prev };
      delete next[currentChannelId];
      return next;
    });

    // DB の last_read_at を更新（fire-and-forget）
    const supabase = sidebarSupabaseRef.current;
    supabase
      .from("channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", currentChannelId)
      .eq("user_id", currentUserId)
      .then(() => {});
  }, [currentChannelId, currentUserId]);

  // ブラウザ通知許可リクエスト（マウント時に一度だけ）
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ネイティブプッシュ通知（Capacitor）のセットアップ
  // Web ブラウザでは中で early return するので副作用なし
  useEffect(() => {
    setupPushNotifications(currentUserId);
  }, [currentUserId]);

  // フォアグラウンド復帰時に未読カウントを再同期
  // モバイルで画面オフ→復帰した際にRealtime取りこぼしを補完
  useEffect(() => {
    async function refetchUnread() {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      const supabase = sidebarSupabaseRef.current;
      const { data } = await supabase.rpc("get_unread_counts", {
        p_user_id: currentUserId,
      });
      if (!data) return;
      const next: Record<string, number> = {};
      for (const row of data as Array<{ channel_id: string; unread_count: number }>) {
        // 現在開いているチャンネルは未読カウントをスキップ
        if (row.channel_id === currentChannelId) continue;
        next[row.channel_id] = Number(row.unread_count);
      }
      setUnreadState(next);
      // ネイティブ（iOS）アプリアイコンのバッジもここで一緒に同期
      syncAppBadgeFromServer(currentUserId);
    }

    document.addEventListener("visibilitychange", refetchUnread);
    window.addEventListener("focus", refetchUnread);
    return () => {
      document.removeEventListener("visibilitychange", refetchUnread);
      window.removeEventListener("focus", refetchUnread);
    };
  }, [currentUserId, currentChannelId]);

  // ワークスペース内のメッセージを Realtime 購読（未読バッジ更新 + 通知）
  useEffect(() => {
    const supabase = sidebarSupabaseRef.current;
    const allChannels = [...channels, ...dmChannels];
    const channelById = new Map(allChannels.map((c) => [c.id, c]));

    const memberNameById = new Map<string, string>();
    for (const m of members) {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      if (p?.display_name) memberNameById.set(m.user_id, p.display_name);
    }

    const subscription = supabase
      .channel(`sidebar-unread-${workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload: RealtimePostgresInsertPayload<Message>) => {
          const msg = payload.new;
          if (msg.parent_id) return;
          if (msg.user_id === currentUserId) return;
          const ch = channelById.get(msg.channel_id);
          if (!ch) return;

          // 表示中チャンネル → 自動既読
          if (msg.channel_id === currentChannelId) {
            supabase
              .from("channel_members")
              .update({ last_read_at: new Date().toISOString() })
              .eq("channel_id", msg.channel_id)
              .eq("user_id", currentUserId)
              .then(() => {});
            return;
          }

          // 未読カウント増加
          setUnreadState((prev) => ({
            ...prev,
            [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
          }));

          // 通知
          const senderName = memberNameById.get(msg.user_id) || "メンバー";
          let channelLabel = ch.name;
          if (ch.is_dm) {
            const dmCh = ch as unknown as {
              channel_members?: Array<{
                user_id: string;
                profiles?: { display_name?: string };
              }>;
            };
            const other = dmCh.channel_members?.find(
              (cm) => cm.user_id !== currentUserId
            );
            channelLabel = other?.profiles?.display_name || "DM";
          }
          showMessageNotification({
            senderName,
            channelName: channelLabel,
            content: msg.content,
            url: `/${workspaceSlug}/${ch.slug}`,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channels, dmChannels, members, currentUserId, currentChannelId, workspace.id, workspaceSlug]);

  // ワークスペース切り替えドロップダウンの外側クリックで閉じる
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wsSwitcherRef.current && !wsSwitcherRef.current.contains(e.target as Node)) {
        setShowWsSwitcher(false);
      }
    }
    if (showWsSwitcher) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showWsSwitcher]);

  // 検索クエリでチャンネルとDMをフィルタリング
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const filteredDmChannels = useMemo(() => {
    if (!searchQuery.trim()) return dmChannels;
    const q = searchQuery.toLowerCase();
    return dmChannels.filter((dm) => {
      const dmWithMembers = dm as unknown as {
        channel_members: Array<{
          user_id: string;
          profiles: { display_name: string };
        }>;
      };
      const otherMembers = dmWithMembers.channel_members?.filter(
        (m) => m.user_id !== currentUserId
      );
      const name = otherMembers?.[0]?.profiles?.display_name || "DM";
      return name.toLowerCase().includes(q);
    });
  }, [dmChannels, searchQuery, currentUserId]);

  return (
    <>
      {/* サイドバー（モバイルではフルスクリーン表示） */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-full sm:w-64 bg-sidebar flex flex-col border-r border-border
          transform transition-transform lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* ヘッダー: 現在のワークスペースを一番目立たせる */}
        <div className="px-4 py-4 border-b border-border/50">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            WORKSPACE
          </div>
          <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0" ref={wsSwitcherRef}>
            <button
              onClick={() => setShowWsSwitcher((prev) => !prev)}
              className="flex items-center gap-1.5 text-xl font-bold text-foreground hover:text-accent transition-colors truncate w-full text-left"
            >
              <span className="truncate">{workspace.name}</span>
              <svg className="w-5 h-5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* ワークスペース切り替えドロップダウン */}
            {showWsSwitcher && (
              <div className="absolute left-0 top-full mt-1 w-full bg-sidebar border border-border rounded-xl shadow-lg z-50 py-1 animate-fade-in">
                {allWorkspaces.map((ws) => (
                  <Link
                    key={ws.id}
                    href={`/${ws.slug}`}
                    onClick={() => setShowWsSwitcher(false)}
                    className={`block px-3 py-2 text-sm truncate transition-colors rounded-lg mx-1 ${
                      ws.id === workspace.id
                        ? "text-accent bg-accent/10 font-semibold"
                        : "text-foreground hover:bg-white/[0.04]"
                    }`}
                  >
                    {ws.name}
                  </Link>
                ))}
                <div className="border-t border-border/50 mt-1 pt-1">
                  <Link
                    href="/?create=true"
                    onClick={() => setShowWsSwitcher(false)}
                    className="block px-3 py-2 text-sm text-muted hover:text-accent transition-colors rounded-lg mx-1 hover:bg-white/[0.04]"
                  >
                    + 新しいワークスペースを作成
                  </Link>
                </div>
              </div>
            )}
          </div>
          {/* WSメンバー一覧ボタン */}
          <button
            onClick={() => setShowWsMembers(true)}
            className="shrink-0 p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-white/[0.04] transition-colors"
            title="ワークスペースメンバー"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
          </div>
        </div>

        {/* 検索バー */}
        <div className="px-3 py-2">
          <input
            type="text"
            placeholder="チャンネルを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background/50 rounded-xl px-3 py-2 text-base border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
          />
        </div>

        {/* チャンネル・DM一覧 */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* 進捗ダッシュボードリンク */}
          <Link
            href={`/${workspaceSlug}/dashboard`}
            prefetch
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-base text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-4 4 4 6-6" />
            </svg>
            進捗ダッシュボード
          </Link>

          {/* ブックマークリンク */}
          <button
            onClick={() => setShowBookmarkModal(true)}
            className="flex items-center gap-2 px-3 py-2.5 text-base text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-2"
          >
            <svg className="w-4 h-4" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            ブックマーク
          </button>

          {/* チャンネルセクション */}
          <div className="px-3 mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase text-muted tracking-wider">
              チャンネル
            </span>
            <button
              onClick={() => setShowCreateChannel(true)}
              className="text-muted hover:text-accent text-lg leading-none transition-colors"
              title="チャンネル作成"
            >
              +
            </button>
          </div>

          {filteredChannels.map((channel) => {
            const href = `/${workspaceSlug}/${channel.slug}`;
            const isActive = pathname === href;
            const isMuted = mutedSet.has(channel.id);
            const unreadCount = unreadState[channel.id] || 0;
            // ミュート中は未読があっても太字／バッジを出さず、全体を薄く
            const showUnreadStyle = unreadCount > 0 && !isActive && !isMuted;
            return (
              <Link
                key={channel.id}
                href={href}
                prefetch
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-3 py-2.5 text-xl rounded-xl mx-2 transition-colors
                  ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }
                  ${isMuted && !isActive ? "opacity-50" : ""}
                `}
              >
                <span
                  className={`mr-2 ${isActive ? "text-accent/50" : "text-accent/50"}`}
                >
                  #
                </span>
                <span className={`truncate ${showUnreadStyle ? "font-semibold text-foreground" : ""}`}>
                  {channel.name}
                </span>
                {/* ミュートアイコン */}
                {isMuted && (
                  <svg
                    className="ml-auto w-4 h-4 text-muted/70 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-label="ミュート中"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                )}
                {/* 未読バッジ（ミュート中は非表示） */}
                {showUnreadStyle && (
                  <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}

          {/* DMセクション */}
          <div className="px-3 mt-4 mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase text-muted tracking-wider">
              ダイレクトメッセージ
            </span>
            <button
              onClick={() => setShowCreateDm(true)}
              className="text-muted hover:text-accent text-lg leading-none transition-colors"
              title="新しいメッセージ"
            >
              +
            </button>
          </div>

          {/* DM一覧 */}
          {filteredDmChannels.map((dm) => {
            const href = `/${workspaceSlug}/${dm.slug}`;
            const isActive = pathname === href;
            const dmWithMembers = dm as unknown as {
              channel_members: Array<{
                user_id: string;
                profiles: {
                  display_name: string;
                  avatar_url: string | null;
                  status: string | null;
                  last_seen_at: string | null;
                };
              }>;
            };
            const otherMember = dmWithMembers.channel_members?.find(
              (m) => m.user_id !== currentUserId
            );
            const name =
              otherMember?.profiles?.display_name || "DM";
            const avatarUrl = otherMember?.profiles?.avatar_url;
            // ステータス取得
            const memberStatus = otherMember?.profiles?.status as string | null;
            // 5分以内のアクティビティでオンライン判定
            const lastSeen = otherMember?.profiles?.last_seen_at;
            const isOnline = lastSeen
              ? Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
              : false;
            // ステータスに応じたドットカラー
            const statusDotColor = memberStatus === "focusing"
              ? "bg-yellow-500"
              : memberStatus === "away"
                ? "bg-muted/50"
                : isOnline
                  ? "bg-online"
                  : "bg-muted/50";
            const dmUnread = unreadState[dm.id] || 0;
            const dmMuted = mutedSet.has(dm.id);
            const dmShowUnreadStyle = dmUnread > 0 && !isActive && !dmMuted;

            return (
              <Link
                key={dm.id}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-2 px-3 py-2.5 text-xl rounded-xl mx-2 transition-colors
                  ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }
                  ${dmMuted && !isActive ? "opacity-50" : ""}
                `}
              >
                {/* アバター + オンラインドット */}
                <span className="relative shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={name}
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-medium text-accent">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar ${statusDotColor}`}
                  />
                </span>
                <span
                  className={`truncate ${dmShowUnreadStyle ? "font-semibold text-foreground" : ""}`}
                >
                  {name}
                </span>
                {/* ミュートアイコン */}
                {dmMuted && (
                  <svg
                    className="ml-auto w-4 h-4 text-muted/70 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-label="ミュート中"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                )}
                {/* 未読バッジ（ミュート中は非表示） */}
                {dmShowUnreadStyle && (
                  <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {dmUnread > 99 ? "99+" : dmUnread}
                  </span>
                )}
              </Link>
            );
          })}

          {/* メンバー招待ボタン */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-3 py-2.5 text-base text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mt-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              />
            </svg>
            メンバーを招待
          </button>

          {/* 検索結果が空の場合 */}
          {searchQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredDmChannels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">
                見つかりませんでした
              </div>
            )}
        </div>

        {/* 下部: ユーザー名 + ステータス + 設定 */}
        <div className="px-3 py-3 border-t border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            {(() => {
              const me = members.find((m) => m.user_id === currentUserId);
              const profile = me?.profiles;
              const p = Array.isArray(profile) ? profile[0] : profile;
              const name = p?.display_name || "ユーザー";
              const initial = name[0].toUpperCase();
              return (
                <>
                  <span className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
                    {p?.avatar_url ? (
                      <img src={p.avatar_url} alt={name} className="w-7 h-7 rounded-full object-cover" />
                    ) : initial}
                  </span>
                  <span className="text-base text-foreground truncate flex-1">{name}</span>
                </>
              );
            })()}
            <button
              onClick={() => setShowSettings(true)}
              className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
              title="設定"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <form
              action={signOut}
              onSubmit={(e) => {
                if (!confirm("ログアウトしますか？")) e.preventDefault();
              }}
            >
              <button
                type="submit"
                className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
                title="ログアウト"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* チャンネル作成モーダル */}
      {showCreateChannel && (
        <CreateChannelModal
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {/* DM作成モーダル */}
      {showCreateDm && (
        <CreateDmModal
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          members={members as Array<{ user_id: string; profiles: MemberProfile }>}
          onClose={() => setShowCreateDm(false)}
        />
      )}

      {/* 招待モーダル */}
      {showInviteModal && (
        <InviteModal
          workspaceId={workspace.id}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* ブックマークモーダル */}
      {showBookmarkModal && (
        <BookmarkModal
          currentUserId={currentUserId}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowBookmarkModal(false)}
        />
      )}

      {/* WSメンバー一覧モーダル */}
      {showWsMembers && (
        <WsMembersModal
          members={members}
          onClose={() => setShowWsMembers(false)}
        />
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border p-6 space-y-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">設定</h2>
              <button onClick={() => setShowSettings(false)} className="p-1 text-muted hover:text-foreground rounded transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* プロフィール */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">プロフィール</h3>
              <div className="flex items-center gap-4 mb-4">
                {/* アバター（クリックで変更） */}
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative w-16 h-16 rounded-full shrink-0 overflow-hidden bg-accent/20 flex items-center justify-center hover:opacity-80 transition-opacity group"
                  disabled={profileUploading}
                >
                  {profileAvatarUrl ? (
                    <img
                      src={profileAvatarUrl}
                      alt="アバター"
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold text-accent">
                      {profileDisplayName ? profileDisplayName[0].toUpperCase() : "?"}
                    </span>
                  )}
                  {/* ホバー時のオーバーレイ */}
                  <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </span>
                  {profileUploading && (
                    <span className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </span>
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
                <div className="flex-1">
                  <label className="text-xs text-muted mb-1 block">表示名</label>
                  <input
                    type="text"
                    value={profileDisplayName}
                    onChange={(e) => setProfileDisplayName(e.target.value)}
                    placeholder="表示名を入力"
                    className="w-full bg-background/50 rounded-xl px-3 py-2 text-sm border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleProfileSave}
                  disabled={profileSaving || !profileDisplayName.trim()}
                  className="px-4 py-2 text-sm rounded-xl bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {profileSaving ? "保存中..." : "保存"}
                </button>
                {profileToast && (
                  <span className="text-sm text-green-400 animate-fade-in">保存しました</span>
                )}
              </div>
            </div>

            {/* 2段階認証 */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">2段階認証</h3>
              <MfaSetup />
            </div>

            {/* テーマ */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">テーマ</h3>
              <ThemeSelector />
            </div>

            {/* ログアウト */}
            <div className="pt-2 border-t border-border/50">
              <form
                action={signOut}
                onSubmit={(e) => {
                  if (!confirm("ログアウトしますか？")) e.preventDefault();
                }}
              >
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
