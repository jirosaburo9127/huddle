"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme-store";

/**
 * テーマプロバイダー
 * Zustandストアからテーマを読み取り、<html>要素にdata-theme属性を設定する
 */
export function ThemeProvider() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return null;
}
