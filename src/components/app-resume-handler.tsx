"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// アプリがバックグラウンドから復帰した時に "huddle:appResumed" カスタムイベントを発火する。
// データ再取得は各購読者 (sidebar の refetchUnread / channel-view の syncMissedMessages 等) が
// このイベントを listen して個別に行う。
//
// 検出経路:
//   1. document.visibilitychange (visible 化)
//   2. window.focus
//   3. window.pageshow (BFCache 復帰)
//   4. Capacitor App.appStateChange (iOS ネイティブ復帰)
//
// 1.5 秒のクールダウンで連続発火を抑制。
//
// ※ 以前は router.refresh() を呼んでいたが、復帰のたびに画面全体が再レンダリングされ
// 「チカっ」と見える原因になっていた。各購読者がイベントで自前再取得するので、
// 全体 refresh は不要。
let nativeListenerAdded = false;

export function AppResumeHandler() {
  useEffect(() => {
    let lastFiredAt = 0;

    function fireResume() {
      const now = Date.now();
      if (now - lastFiredAt < 1500) return;
      lastFiredAt = now;
      window.dispatchEvent(new CustomEvent("huddle:appResumed"));
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
  }, []);

  return null;
}
