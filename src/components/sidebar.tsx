"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, Channel } from "@/lib/supabase/types";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";

type SidebarProps = {
  workspace: Workspace;
  channels: Channel[];
  dmChannels: Channel[];
  members: unknown[];
  currentUserId: string;
  workspaceSlug: string;
};

export function Sidebar({
  workspace,
  channels,
  dmChannels,
  currentUserId,
  workspaceSlug,
}: SidebarProps) {
  const pathname = usePathname();
  const [showCreateChannel, setShowCreateChannel] = useState(false);
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
                <span className="truncate">{channel.name}</span>
              </Link>
            );
          })}

          {/* DM一覧 */}
          {filteredDmChannels.length > 0 && (
            <>
              <div className="px-3 mt-4 mb-1">
                <span className="text-xs font-semibold uppercase text-muted tracking-wider">
                  ダイレクトメッセージ
                </span>
              </div>
              {filteredDmChannels.map((dm) => {
                const href = `/${workspaceSlug}/${dm.slug}`;
                const isActive = pathname === href;
                const dmWithMembers = dm as unknown as {
                  channel_members: Array<{
                    user_id: string;
                    profiles: { display_name: string };
                  }>;
                };
                const otherMembers = dmWithMembers.channel_members?.filter(
                  (m) => m.user_id !== currentUserId
                );
                const name =
                  otherMembers?.[0]?.profiles?.display_name || "DM";

                return (
                  <Link
                    key={dm.id}
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
                    <span className="mr-2 w-2 h-2 rounded-full bg-online inline-block shrink-0" />
                    <span className="truncate">{name}</span>
                  </Link>
                );
              })}
            </>
          )}

          {/* 検索結果が空の場合 */}
          {searchQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredDmChannels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">
                見つかりませんでした
              </div>
            )}
        </div>

        {/* 下部: テーマ切り替え & ログアウト */}
        <div className="flex items-center justify-between px-3 py-3 border-t border-border/50">
          <ThemeSelector />
          <form action={signOut}>
            <button
              type="submit"
              className="text-muted hover:text-foreground transition-colors p-2 rounded-lg hover:bg-sidebar-hover"
              title="ログアウト"
            >
              {/* ドアアイコン */}
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </form>
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
    </>
  );
}
