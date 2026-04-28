"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

// プッシュ通知のタップで該当チャンネルに遷移するためのハンドラ。
// サイドバー側の setupPushNotifications でも同じイベントを listen していたが、
// サイドバーが mount されるまで登録されないため、cold start 時の通知タップを
// 取りこぼしていた。レイアウト直下に置いて起動直後から listen させる。
let listenerAdded = false;

export function PushTapHandler() {
  const router = useRouter();

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
            if (!url) return;
            // SPA 遷移を試みつつ、確実に画面切替するため少し遅らせて
            // ハードナビにフォールバック
            try {
              router.push(url);
            } catch {
              // 失敗時のフォールバック
            }
            // Capacitor の WebView では router.push が効かないケースもあるため
            // ハードナビで保険
            setTimeout(() => {
              if (typeof window !== "undefined" && window.location.pathname !== url) {
                window.location.href = url;
              }
            }, 200);
          }
        );
      } catch {
        listenerAdded = false;
      }
    })();
  }, [router]);

  return null;
}
