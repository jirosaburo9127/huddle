"use client";

import { useThemeStore } from "@/stores/theme-store";

const themes = [
  { name: "midnight" as const, color: "#16161e", label: "Midnight", description: "ダークモード" },
  { name: "dawn" as const, color: "#f7f7fa", label: "Dawn", description: "ライトモード" },
  { name: "forest" as const, color: "#141e1a", label: "Forest", description: "グリーンダーク" },
] as const;

export function ThemeSelector() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="flex gap-3">
      {themes.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => setTheme(t.name)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
            theme === t.name
              ? "border-accent bg-accent/10"
              : "border-border hover:border-accent/30"
          }`}
        >
          <span
            className="w-8 h-8 rounded-full border border-border shrink-0"
            style={{ backgroundColor: t.color }}
          />
          <div className="text-left">
            <p className={`text-sm font-medium ${theme === t.name ? "text-accent" : "text-foreground"}`}>
              {t.label}
            </p>
            <p className="text-[11px] text-muted">{t.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
