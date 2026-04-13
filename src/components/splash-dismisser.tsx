"use client";

// Capacitor ネイティブアプリでアプリ起動時のスプラッシュスクリーンを
// React マウント完了時に閉じる。Web 版では何もしない。
//
// capacitor.config.ts 側で launchAutoHide: false にしてあるので、
// ここで hide を呼ばないとスプラッシュが残り続ける（10秒でフォールバック非表示）。

import { useEffect } from "react";

export function SplashDismisser() {
  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { SplashScreen } = await import("@capacitor/splash-screen");
        // 次のフレームまで待ってから閉じる（React の初回描画が終わってから）
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
