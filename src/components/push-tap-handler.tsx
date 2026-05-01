"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

// プッシュ通知のタップで該当チャンネルに遷移するためのハンドラ。
// レイアウト直下に置いて起動直後から listen させる（cold start 取りこぼし防止）。
//
// 遷移戦略:
//   1. まず Next.js Router の push() で SPA ナビ
//      → 早い・チラつかない・状態保持
//   2. 1.2 秒後に pathname が期待値と違っていればハードナビでフォールバック
//      → SPA ナビが効かなかった場合の救済（cold start 直後など）
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
            if (!url || typeof window === "undefined") return;

            // 1) SPA ナビ
            try {
              router.push(url);
            } catch {
              // router が使えないタイミングなら即ハードナビ
              window.location.href = url;
              return;
            }

            // 2) フォールバック: 1.2 秒経っても遷移していなければハードナビ
            setTimeout(() => {
              try {
                const expected = new URL(url, window.location.origin).pathname;
                if (window.location.pathname !== expected) {
                  window.location.href = url;
                }
              } catch {
                /* noop */
              }
            }, 1200);
          }
        );
      } catch {
        listenerAdded = false;
      }
    })();
  }, [router]);

  return null;
}
