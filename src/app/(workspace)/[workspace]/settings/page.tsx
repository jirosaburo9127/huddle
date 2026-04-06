"use client";

import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
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
