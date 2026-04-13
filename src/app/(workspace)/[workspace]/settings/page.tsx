"use client";

import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";

export default function SettingsPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        {/* モバイル: サイドバーを開くボタン（元のチャンネルに戻るため） */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <h1 className="font-bold text-lg">設定</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-xl">
        {/* テーマ設定 */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">テーマ</h2>
          <ThemeSelector />
        </section>

        {/* ログアウト */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">アカウント</h2>
          <form action={signOut}>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
            >
              ログアウト
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
