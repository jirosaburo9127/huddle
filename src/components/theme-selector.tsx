"use client";

import { useThemeStore } from "@/stores/theme-store";

// テーマ選択肢の定義
const themes = [
  { name: "midnight" as const, color: "#16161e", label: "Midnight" },
  { name: "dawn" as const, color: "#f5f5f7", label: "Dawn" },
  { name: "forest" as const, color: "#141e1a", label: "Forest" },
] as const;

/**
 * テーマ切り替えボタン群
 * 3つの色付き丸ボタンを横並びで表示し、選択中にリングを表示する
 */
export function ThemeSelector() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="text-xs text-muted mr-1">テーマ</span>
      {themes.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => setTheme(t.name)}
          title={t.label}
          className={`
            w-6 h-6 rounded-full border border-border cursor-pointer transition-all
            ${theme === t.name ? "ring-2 ring-accent ring-offset-2 ring-offset-sidebar" : ""}
          `}
          style={{ backgroundColor: t.color }}
        />
      ))}
    </div>
  );
}
