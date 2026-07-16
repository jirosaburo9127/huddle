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

            // ★一時デバッグ: タップ時の状態を可視化（原因特定後に削除）
            {
              const seg = (p: string) => p.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] || "(なし)";
              const cur = typeof window !== "undefined" ? seg(window.location.pathname) : "?";
              try {
                alert(`[push v2] タップ受信\nurl=${url ?? "なし"}\n遷移先WS=${url ? seg(url) : "-"}\n現在WS=${cur}\nデータ全体=${JSON.stringify(data)}`);
              } catch { /* noop */ }
            }

            if (!url || typeof window === "undefined") return;

            // ワークスペースを跨ぐ遷移は SPA ナビだと表示が切り替わらないことがある
            // （URL は変わるが別ワークスペースのレイアウト/状態が更新されず、
            //   開いていたチャンネルのままになる）。跨ぐ時は確実にハードナビで遷移する。
            const firstSeg = (p: string) => p.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] || "";
            const targetWs = firstSeg(url);
            const currentWs = firstSeg(window.location.pathname);
            if (targetWs && targetWs !== currentWs) {
              window.location.href = url;
              return;
            }

            // 1) SPA ナビ（同一ワークスペース内）
            try {
              router.push(url);
            } catch {
              // router が使えないタイミングなら即ハードナビ
              window.location.href = url;
              return;
            }

            // 2) フォールバック: 1.2 秒経っても遷移していなければハードナビ
            //    pathname だけでなく search (クエリ文字列) も含めて比較する
            //    （?m=<id> 付き URL で同一チャンネルだと pathname が同じでも遷移が必要）
            setTimeout(() => {
              try {
                const parsed = new URL(url, window.location.origin);
                const current = window.location.pathname + window.location.search;
                const expected = parsed.pathname + parsed.search;
                if (current !== expected) {
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
