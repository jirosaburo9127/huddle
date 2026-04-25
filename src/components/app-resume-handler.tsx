"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

// アプリがバックグラウンドから復帰した瞬間に未読カウントを再取得させるための
// 中央集権的なハンドラ。サイドバーが mount されていない画面でも動かせるように
// レイアウト直下に配置する。
//
// 検出経路:
//   1. document.visibilitychange (visible 化)
//   2. window.focus
//   3. window.pageshow (BFCache 復帰)
//   4. Capacitor App.appStateChange (iOS ネイティブ復帰)
//
// 1.5 秒のクールダウンで連続発火を抑制。
// router.refresh() で SSR 由来の unreadCounts も再取得する。
let nativeListenerAdded = false;

export function AppResumeHandler() {
  const router = useRouter();

  useEffect(() => {
    let lastFiredAt = 0;

    function fireResume() {
      const now = Date.now();
      if (now - lastFiredAt < 1500) return;
      lastFiredAt = now;
      window.dispatchEvent(new CustomEvent("huddle:appResumed"));
      router.refresh();
    }

    function onVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") fireResume();
    }

    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) fireResume();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", fireResume);
    window.addEventListener("pageshow", onPageShow);

    if (Capacitor.isNativePlatform() && !nativeListenerAdded) {
      nativeListenerAdded = true;
      (async () => {
        try {
          const { App } = await import("@capacitor/app");
          await App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) fireResume();
          });
        } catch {
          nativeListenerAdded = false;
        }
      })();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", fireResume);
      window.removeEventListener("pageshow", onPageShow);
      // ネイティブリスナーは module スコープのフラグで管理しているので解除しない
    };
  }, [router]);

  return null;
}
