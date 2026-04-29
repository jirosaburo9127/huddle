"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// プッシュ通知のタップで該当チャンネルに遷移するためのハンドラ。
// サイドバー側の setupPushNotifications でも同じイベントを listen していたが、
// サイドバーが mount されるまで登録されないため、cold start 時の通知タップを
// 取りこぼしていた。レイアウト直下に置いて起動直後から listen させる。
//
// 遷移は window.location.href によるハードナビで行う。Capacitor の WKWebView は
// server URL (vercel.app) を再ロードするだけなので確実に target チャンネルに着く。
let listenerAdded = false;

export function PushTapHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (listenerAdded) return;
    listenerAdded = true;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const data = action.notification.data as { url?: string } | undefined;
            const url = data?.url;
            if (!url || typeof window === "undefined") return;
            window.location.href = url;
          }
        );
      } catch {
        listenerAdded = false;
      }
    })();
  }, []);

  return null;
}
