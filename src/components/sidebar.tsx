"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, Channel } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { CreateDmModal } from "@/components/create-dm-modal";
import { InviteModal } from "@/components/invite-modal";
import { BookmarkModal } from "@/components/bookmark-modal";
import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";

// Quick Pulse ステータス定義
type PulseStatus = "available" | "focusing" | "away";

const PULSE_OPTIONS: { value: PulseStatus; label: string; icon: string; className: string }[] = [
  { value: "available", label: "話せます", icon: "🟢", className: "bg-online/20 text-online border-online/30" },
  { value: "focusing", label: "集中中", icon: "🟡", className: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30" },
  { value: "away", label: "離席", icon: "⚫", className: "bg-muted/20 text-muted border-muted/30" },
];

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
  allWorkspaces,
}: SidebarProps) {
  const pathname = usePathname();
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateDm, setShowCreateDm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWsSwitcher, setShowWsSwitcher] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<PulseStatus | null>(null);
  const wsSwitcherRef = useRef<HTMLDivElement>(null);
  const { sidebarOpen, setSidebarOpen } = useMobileNavStore();
  const [searchQuery, setSearchQuery] = useState("");
  const supabase = createClient();

  // 初回ステータス取得
  useEffect(() => {
    async function fetchStatus() {
      const { data } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", currentUserId)
        .single();
      if (data?.status) {
        setCurrentStatus(data.status as PulseStatus);
      }
    }
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // ステータス更新
  const handleStatusChange = useCallback(async (status: PulseStatus) => {
    setCurrentStatus(status);
    await supabase
      .from("profiles")
      .update({ status })
      .eq("id", currentUserId);
  }, [supabase, currentUserId]);

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
        {/* ヘッダー: アプリ名 + ワークスペース切り替え */}
        <div className="px-4 py-3 border-b border-border/50">
          <h1 className="font-bold text-3xl text-accent">Huddle</h1>
          <div className="relative" ref={wsSwitcherRef}>
            <button
              onClick={() => setShowWsSwitcher((prev) => !prev)}
              className="flex items-center gap-1 text-lg text-muted hover:text-foreground transition-colors truncate w-full text-left"
            >
              <span className="truncate">{workspace.name}</span>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* ワークスペース切り替えドロップダウン */}
            {showWsSwitcher && (
              <div className="absolute left-0 top-full mt-1 w-full bg-sidebar border border-border rounded-xl shadow-lg z-50 py-1 animate-fade-in">
                {allWorkspaces.map((ws) => (
                  <Link
                    key={ws.id}
                    href={`/${ws.slug}/general`}
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
          <p className="text-[10px] text-muted/50 mt-1 ml-1">
            ⌘K でメッセージ検索
          </p>
        </div>

        {/* チャンネル・DM一覧 */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* ブックマークリンク */}
          <button
            onClick={() => setShowBookmarkModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-2"
          >
            <svg className="w-4 h-4" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            ブックマーク
          </button>

          {/* チャンネルセクション */}
          <div className="px-3 mb-1 flex items-center justify-between">
            <span className="text-[13px] font-semibold uppercase text-muted tracking-wider">
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
            const unreadCount = unreadCounts[channel.id] || 0;
            return (
              <Link
                key={channel.id}
                href={href}
                prefetch
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-3 py-2 text-lg rounded-xl mx-2 transition-colors
                  ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }
                `}
              >
                <span
                  className={`mr-2 ${isActive ? "text-accent/50" : "text-accent/50"}`}
                >
                  #
                </span>
                <span className={`truncate ${unreadCount > 0 && !isActive ? "font-semibold text-foreground" : ""}`}>
                  {channel.name}
                </span>
                {/* 未読バッジ */}
                {unreadCount > 0 && (
                  <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}

          {/* DMセクション */}
          <div className="px-3 mt-4 mb-1 flex items-center justify-between">
            <span className="text-[13px] font-semibold uppercase text-muted tracking-wider">
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
            const memberStatus = otherMember?.profiles?.status as PulseStatus | null;
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

            return (
              <Link
                key={dm.id}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-2 px-3 py-2 text-lg rounded-xl mx-2 transition-colors
                  ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }
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
                <span className="truncate">{name}</span>
              </Link>
            );
          })}

          {/* メンバー招待ボタン */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mt-2"
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
            <form action={signOut}>
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
          {/* Quick Pulse ステータスボタン */}
          <div className="flex items-center gap-1">
            {PULSE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] rounded-lg border transition-all ${opt.className} ${
                  currentStatus === opt.value ? "ring-1 ring-current" : "opacity-60 hover:opacity-100"
                }`}
              >
                <span>{opt.icon}</span>
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
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

            {/* テーマ */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">テーマ</h3>
              <ThemeSelector />
            </div>

            {/* ログアウト */}
            <div className="pt-2 border-t border-border/50">
              <form action={signOut}>
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
