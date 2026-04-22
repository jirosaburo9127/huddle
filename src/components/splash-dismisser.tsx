"use client";

// Capacitor ネイティブアプリでアプリ起動時のスプラッシュスクリーンを
// React マウント完了時に閉じる。Web 版では何もしない。

import { useEffect } from "react";

export function SplashDismisser() {
  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { SplashScreen } = await import("@capacitor/splash-screen");
        requestAnimationFrame(() => {
          SplashScreen.hide().catch(() => {});
        });
      } catch {
        // プラグイン未導入や Web 実行時は無視
      }
    })();
  }, []);

  return null;
}
