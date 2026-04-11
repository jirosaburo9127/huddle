"use client";

import { useEffect } from "react";
import { useMobileNavStore } from "@/stores/mobile-nav-store";

// ワークスペーストップのメイン領域。
// サイドバーに既に一覧が出ているので、メイン領域はウェルカム表示のみ。
// モバイルではマウント時にサイドバーを開いて、実質「一覧画面」にする。
export function WorkspaceLobby({ workspaceSlug }: { workspaceSlug: string }) {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);

  useEffect(() => {
    // モバイルでワークスペースを切り替えた直後はサイドバーを開いて一覧を見せる
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="サイドバーを開く"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="font-bold text-lg">ようこそ</h1>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2 text-foreground">
            左のサイドバーからチャンネルを選んでください
          </h2>
          <p className="text-sm text-muted">
            チャンネル一覧・ダイレクトメッセージはサイドバーに表示されています。
          </p>
          <p className="text-xs text-muted/70 mt-4">workspace: {workspaceSlug}</p>
        </div>
      </div>
    </div>
  );
}
