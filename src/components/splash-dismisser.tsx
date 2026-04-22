"use client";

// アプリ起動時のローディング画面（ロゴ回転）
// 初回マウント時に表示し、1秒後からフェードアウト可能状態になる。
// コンテンツが読み込まれたら自動的にフェードアウト。

import { useEffect, useState } from "react";

export function SplashDismisser() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // 最低500ms表示してからフェードアウト可能にする
    const minTimer = setTimeout(() => {
      setFadeOut(true);
      // フェードアウトアニメーション後に完全非表示
      setTimeout(() => setVisible(false), 400);
    }, 800);

    return () => clearTimeout(minTimer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center transition-opacity duration-400 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <img
        src="/icons/logo-transparent.png"
        alt="Huddle"
        className="w-16 h-16 animate-spin-slow"
      />
    </div>
  );
}
