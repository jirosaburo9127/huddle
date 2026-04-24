"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { BookmarkModal } from "@/components/bookmark-modal";
import { WsMembersModal } from "@/components/ws-members-modal";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  members: Array<{ user_id: string; profiles: { id: string; display_name: string; avatar_url: string | null; status: string | null } | Array<{ id: string; display_name: string; avatar_url: string | null; status: string | null }> }>;
};

export function BottomTabBar({ workspaceSlug, workspaceId, currentUserId, members }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const [showMore, setShowMore] = useState(false);
  const [showBookmark, setShowBookmark] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const isHome = !pathname.includes("/dm-list") && !pathname.includes("/in-progress") && !pathname.includes("/calendar") && !pathname.includes("/files") && !pathname.includes("/dashboard");
  const isInProgress = pathname.includes("/in-progress");
  const isCalendar = pathname.includes("/calendar");
  const isFiles = pathname.includes("/files");

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-[55] bg-sidebar border-t border-border lg:hidden safe-area-bottom">
        <div className="flex items-center justify-around py-1 px-2">
          {/* ホーム */}
          <button
            onClick={() => setSidebarOpen(true)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isHome ? "text-accent" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill={isHome ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isHome ? 0 : 1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            <span className="text-[10px]">ホーム</span>
          </button>

          {/* 進行中 */}
          <Link
            href={`/${workspaceSlug}/in-progress`}
            onClick={() => setSidebarOpen(false)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isInProgress ? "text-blue-400" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[10px]">進行中</span>
          </Link>

          {/* カレンダー */}
          <Link
            href={`/${workspaceSlug}/calendar`}
            onClick={() => setSidebarOpen(false)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isCalendar ? "text-accent" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill={isCalendar ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isCalendar ? 0 : 1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <span className="text-[10px]">カレンダー</span>
          </Link>

          {/* 決定事項 */}
          <Link
            href={`/${workspaceSlug}/dashboard`}
            onClick={() => setSidebarOpen(false)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              pathname.includes("/dashboard") ? "text-accent" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[10px]">決定</span>
          </Link>

          {/* その他 */}
          <button
            onClick={() => setShowMore((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              showMore ? "text-accent" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
            <span className="text-[10px]">その他</span>
          </button>
        </div>
      </nav>

      {/* その他メニュー */}
      {showMore && (
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full mb-16 mx-4 rounded-2xl bg-sidebar border border-border p-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-3">
              <a
                href={`/${workspaceSlug}/search`}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">検索</span>
              </a>
              <a
                href={`/${workspaceSlug}/dm-list`}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">DM</span>
              </a>
              <a
                href={`/${workspaceSlug}/files`}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">ファイル</span>
              </a>
              <button
                onClick={() => { setShowMore(false); setShowBookmark(true); }}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">ブックマーク</span>
              </button>
              <button
                onClick={() => { setShowMore(false); setShowMembers(true); }}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">メンバー</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showBookmark && (
        <BookmarkModal
          currentUserId={currentUserId}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowBookmark(false)}
        />
      )}

      {showMembers && (
        <WsMembersModal
          members={members}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}
