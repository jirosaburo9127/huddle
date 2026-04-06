"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, Channel } from "@/lib/supabase/types";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { CreateDmModal } from "@/components/create-dm-modal";
import { signOut } from "@/lib/actions";

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
};

export function Sidebar({
  workspace,
  channels,
  dmChannels,
  members,
  currentUserId,
  workspaceSlug,
  unreadCounts = {},
}: SidebarProps) {
  const pathname = usePathname();
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateDm, setShowCreateDm] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
      {/* モバイルハンバーガー */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-3 left-3 z-50 rounded-lg bg-sidebar/90 backdrop-blur-sm p-2 lg:hidden"
      >
        <svg
          className="h-5 w-5 text-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* オーバーレイ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* サイドバー */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-sidebar flex flex-col border-r border-border
          transform transition-transform lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* ヘッダー: アプリ名 + ワークスペース名 */}
        <div className="px-4 py-3 border-b border-border/50">
          <h1 className="font-bold text-xl text-accent">Huddle</h1>
          <p className="text-sm text-muted truncate">{workspace.name}</p>
        </div>

        {/* 検索バー */}
        <div className="px-3 py-2">
          <input
            type="text"
            placeholder="チャンネルを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background/50 rounded-xl px-3 py-2 text-sm border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
          />
          <p className="text-[10px] text-muted/50 mt-1 ml-1">
            ⌘K でメッセージ検索
          </p>
        </div>

        {/* チャンネル・DM一覧 */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* チャンネルセクション */}
          <div className="px-3 mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted tracking-wider">
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
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-3 py-2 text-sm rounded-xl mx-2 transition-colors
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
            <span className="text-xs font-semibold uppercase text-muted tracking-wider">
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
            // 5分以内のアクティビティでオンライン判定
            const lastSeen = otherMember?.profiles?.last_seen_at;
            const isOnline = lastSeen
              ? Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
              : false;

            return (
              <Link
                key={dm.id}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-2 px-3 py-2 text-sm rounded-xl mx-2 transition-colors
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
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar ${
                      isOnline ? "bg-online" : "bg-muted/50"
                    }`}
                  />
                </span>
                <span className="truncate">{name}</span>
              </Link>
            );
          })}

          {/* 検索結果が空の場合 */}
          {searchQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredDmChannels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">
                見つかりませんでした
              </div>
            )}
        </div>

        {/* 下部: ユーザー名 + 設定 */}
        <div className="flex items-center gap-2 px-3 py-3 border-t border-border/50">
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
                <span className="text-sm text-foreground truncate flex-1">{name}</span>
              </>
            );
          })()}
          <Link
            href={`/${workspaceSlug}/settings`}
            className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
            title="設定"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
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
    </>
  );
}
