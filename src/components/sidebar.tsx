"use client";

import { useState } from "react";
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

  return (
    <>
      {/* モバイルハンバーガー */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-3 left-3 z-50 rounded-lg bg-sidebar p-2 lg:hidden"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
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
        {/* ワークスペース名 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-bold text-lg truncate">{workspace.name}</h2>
        </div>

        {/* チャンネル一覧 */}
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted tracking-wider">
              チャンネル
            </span>
            <button
              onClick={() => setShowCreateChannel(true)}
              className="text-muted hover:text-foreground text-lg leading-none"
              title="チャンネル作成"
            >
              +
            </button>
          </div>

          {channels.map((channel) => {
            const href = `/${workspaceSlug}/${channel.slug}`;
            const isActive = pathname === href;
            return (
              <Link
                key={channel.id}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-4 py-1.5 text-sm rounded-md mx-2 transition-colors
                  ${isActive ? "bg-sidebar-active text-foreground" : "text-muted hover:bg-sidebar-hover hover:text-foreground"}
                `}
              >
                <span className="mr-2 text-muted">#</span>
                <span className="truncate">{channel.name}</span>
              </Link>
            );
          })}

          {/* DM一覧 */}
          {dmChannels.length > 0 && (
            <>
              <div className="px-3 mt-4 mb-1">
                <span className="text-xs font-semibold uppercase text-muted tracking-wider">
                  ダイレクトメッセージ
                </span>
              </div>
              {dmChannels.map((dm) => {
                const href = `/${workspaceSlug}/${dm.slug}`;
                const isActive = pathname === href;
                const dmWithMembers = dm as unknown as { channel_members: Array<{ user_id: string; profiles: { display_name: string } }> };
                const otherMembers = dmWithMembers.channel_members?.filter((m) => m.user_id !== currentUserId);
                const name = otherMembers?.[0]?.profiles?.display_name || "DM";

                return (
                  <Link
                    key={dm.id}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center px-4 py-1.5 text-sm rounded-md mx-2 transition-colors
                      ${isActive ? "bg-sidebar-active text-foreground" : "text-muted hover:bg-sidebar-hover hover:text-foreground"}
                    `}
                  >
                    <span className="mr-2 w-2 h-2 rounded-full bg-online inline-block" />
                    <span className="truncate">{name}</span>
                  </Link>
                );
              })}
            </>
          )}
        </div>

        {/* テーマ切り替え & ユーザーメニュー */}
        <div className="px-3 py-3 border-t border-border space-y-2">
          <ThemeSelector />
          <form action={signOut}>
            <button
              type="submit"
              className="w-full text-left text-sm text-muted hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-sidebar-hover"
            >
              ログアウト
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
