"use client";

// Capacitor ネイティブアプリでアプリ起動時のスプラッシュスクリーンを
// React マウント完了時に閉じ、Webローディング画面（ロゴ回転）を表示する。
// ページのデータ読み込みが完了したら自動的にフェードアウトする。

import { useEffect, useState } from "react";

export function SplashDismisser() {
  const [showLoading, setShowLoading] = useState(true);
  const [isNative, setIsNative] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) {
          setShowLoading(false);
          return;
        }
        setIsNative(true);
        const { SplashScreen } = await import("@capacitor/splash-screen");
        // ネイティブスプラッシュを即座に隠す（Web側のローディングに切り替え）
        requestAnimationFrame(() => {
          SplashScreen.hide().catch(() => {});
        });
        // 最低1秒はローディングを表示（データ取得を待つ）、最大5秒で消す
        timer = setTimeout(() => {
          setFadeOut(true);
          setTimeout(() => setShowLoading(false), 300);
        }, 5000);
      } catch {
        setShowLoading(false);
      }
    })();

    return () => { if (timer) clearTimeout(timer); };
  }, []);

  // ページ描画完了を検知して早めにローディングを消す
  useEffect(() => {
    if (!isNative || !showLoading) return;
    // MutationObserverでメインコンテンツの出現を監視
    const observer = new MutationObserver(() => {
      // チャンネルビューかサイドバーが描画されたら消す
      const hasContent = document.querySelector("[data-channel-view]") ||
        document.querySelector("[data-sidebar]");
      if (hasContent) {
        setFadeOut(true);
        setTimeout(() => setShowLoading(false), 300);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isNative, showLoading]);

  if (!showLoading) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center transition-opacity duration-300 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/icons/logo-transparent.png"
        alt="Huddle"
        className="w-16 h-16 animate-spin-slow"
      />
      <p className="text-sm text-muted mt-4">読み込み中...</p>
    </div>
  );
}
