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

            // WKWebView(Capacitor)では相対パスの window.location では遷移しないため、
            // 必ず絶対URLにする。
            const dest = new URL(url, window.location.origin).href;
            const firstSeg = (p: string) => p.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] || "";
            const targetWs = firstSeg(url);
            const currentWs = firstSeg(window.location.pathname);

            // ワークスペースを跨ぐ遷移は SPA ナビだと表示が切り替わらない
            // （URLは変わるが別WSのレイアウト/状態が更新されず開いていたチャンネルのまま）。
            // 跨ぐ時は絶対URLへハードナビして確実に切り替える。
            if (targetWs && targetWs !== currentWs) {
              window.location.assign(dest);
              return;
            }

            // 同一ワークスペース内は SPA ナビ（速い・チラつかない）
            try {
              router.push(url);
            } catch {
              window.location.assign(dest);
              return;
            }

            // フォールバック: 1.2秒経っても遷移していなければハードナビ（絶対URL）
            // ?m=<id> 付きで同一チャンネルだと pathname が同じでも遷移が必要なので
            // search も含めて比較する。
            setTimeout(() => {
              try {
                const parsed = new URL(dest);
                const current = window.location.pathname + window.location.search;
                const expected = parsed.pathname + parsed.search;
                if (current !== expected) window.location.assign(dest);
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
