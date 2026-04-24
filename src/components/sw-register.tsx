"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Service Worker は廃止する。
    // iOS WKWebView (Capacitor) で SW の fetch ハンドラが navigation を
    // 横取りしてしまう問題があり、かつアプリ側で必要な機能（プッシュ通知は
    // @capacitor/push-notifications、オフライン表示は標準画面）は全て
    // 別手段で実装済みのため、SW は残す理由がなくなった。
    // 既に登録されている SW があれば全て unregister し、キャッシュも削除する。
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
    }

    // 通知許可リクエスト
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // 少し待ってから許可リクエスト（UXのため）
      const timer = setTimeout(() => {
        Notification.requestPermission();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  return null;
}
