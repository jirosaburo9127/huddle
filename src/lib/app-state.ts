"use client";

// Capacitor App プラグインの appStateChange を window CustomEvent に橋渡しする。
// iOS WKWebView では visibilitychange / focus が復帰時に発火しないことがあるため、
// ネイティブの applicationDidBecomeActive を確実に拾うのが目的。
// 複数コンポーネントが "huddle:appResumed" を listen できるよう、
// ネイティブリスナー登録はプロセス中で1回だけ行う。

import { Capacitor } from "@capacitor/core";

let listenerAdded = false;

export async function setupAppStateHandler(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  if (listenerAdded) return;
  listenerAdded = true;

  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        window.dispatchEvent(new CustomEvent("huddle:appResumed"));
      }
    });
  } catch {
    // プラグイン未登録 / 権限問題等 → 静かに諦める（visibilitychange がフォールバック）
    listenerAdded = false;
  }
}
