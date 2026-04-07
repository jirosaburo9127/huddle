import { create } from "zustand";
import { persist } from "zustand/middleware";

// テーマ名の型定義
type ThemeName = "midnight" | "dawn" | "warm";

type ThemeStore = {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: "midnight",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "huddle-theme" }
  )
);
