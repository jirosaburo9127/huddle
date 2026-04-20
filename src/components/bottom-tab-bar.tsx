"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { BookmarkModal } from "@/components/bookmark-modal";

type Props = {
  workspaceSlug: string;
  currentUserId: string;
};

export function BottomTabBar({ workspaceSlug, currentUserId }: Props) {
  const pathname = usePathname();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const [showMore, setShowMore] = useState(false);
  const [showBookmark, setShowBookmark] = useState(false);

  const isHome = !pathname.includes("/dm-list") && !pathname.includes("/in-progress") && !pathname.includes("/files") && !pathname.includes("/dashboard");
  const isDm = pathname.includes("/dm-list");
  const isInProgress = pathname.includes("/in-progress");
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

          {/* DM */}
          <Link
            href={`/${workspaceSlug}/dm-list`}
            onClick={() => setSidebarOpen(false)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isDm ? "text-accent" : "text-muted"
            }`}
          >
            <svg className="w-6 h-6" fill={isDm ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isDm ? 0 : 1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-[10px]">DM</span>
          </Link>

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
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full mb-16 mx-4 rounded-2xl bg-sidebar border border-border p-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href={`/${workspaceSlug}/files`}
                onClick={() => setShowMore(false)}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">ファイル</span>
              </Link>
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
    </>
  );
}
