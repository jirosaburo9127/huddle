// Capacitor + Supabase によるネイティブプッシュ通知のセットアップ
// ネイティブ環境(iOS Capacitor)でのみ動作。Webブラウザでは何もしない。

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { Badge } from "@capawesome/capacitor-badge";
import { createClient } from "@/lib/supabase/client";

// 同一モジュールコンテキスト内の多重実行を防ぐための Promise キャッシュ
// （1度目が走り終わるまで 2度目は待つ、終わっても再度実行可能）
let currentSetupPromise: Promise<void> | null = null;
// addListener は一度だけ登録する（重複登録防止）
let listenersAdded = false;
// resume (visibilitychange) リスナーも1度だけ登録
let resumeListenerAdded = false;
// 最後にトークンを再登録した時刻。短時間に連打しないよう制御
let lastRegisterAt = 0;
const REGISTER_COOLDOWN_MS = 60 * 1000; // 60秒

/**
 * iOS アプリアイコンのバッジを任意の数値にセット（0でクリア）。
 * Badge プラグインが未対応な環境では静かに失敗する。
 */
async function setAppIconBadge(count: number): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Badge.set({ count: Math.max(0, count) });
  } catch {
    // 未対応環境（Web・権限なしなど）は無視
  }
}

/**
 * 現在のユーザーの未読合計を Supabase から取得し、アプリアイコンのバッジに反映する。
 * サイドバーと同じ `get_unread_counts` RPC を使うので値は必ずサーバ真実と一致する。
 */
export async function syncAppBadgeFromServer(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_unread_counts", {
      p_user_id: userId,
    });
    if (error || !data) {
      await setAppIconBadge(0);
      return;
    }
    const total = (data as Array<{ unread_count: number }>).reduce(
      (sum, row) => sum + Number(row.unread_count || 0),
      0
    );
    await setAppIconBadge(total);
  } catch {
    // 通信エラー等は無視（次回同期で回復）
  }
}

/**
 * iOS アプリアイコンのバッジと通知センターの既配信通知をクリアする。
 * チャンネルを開いたとき・アプリがフォアグラウンドに戻ったときに呼ぶ。
 * userId を渡せば、クリア後にサーバの真実と再同期する（別チャンネルに未読が残っていれば数字が残る）。
 */
export async function clearPushBadge(userId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // プラグイン未対応など、失敗しても UI には影響しない
  }
  if (userId) {
    await syncAppBadgeFromServer(userId);
  } else {
    await setAppIconBadge(0);
  }
}

/**
 * プッシュ通知の権限をリクエストし、デバイストークンを Supabase に登録する。
 * - Webブラウザでは何もしない（Capacitor.isNativePlatform() で判定）
 * - 同じセッション内で複数回呼ばれても1度だけ実行される
 */
export async function setupPushNotifications(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;

  // 同時実行を1つに制限（複数回呼ばれても内部で1回にまとめる）
  if (currentSetupPromise) return currentSetupPromise;

  currentSetupPromise = (async () => {
    try {
      // 1. 権限確認
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === "prompt") {
        permStatus = await PushNotifications.requestPermissions();
      }
      if (permStatus.receive !== "granted") {
        return;
      }

      // 2. イベントリスナー登録（初回のみ）
      if (!listenersAdded) {
        listenersAdded = true;

        // registration: 新しいトークンが発行されたら device_tokens に保存
        await PushNotifications.addListener("registration", async (token) => {
          // eslint-disable-next-line no-console
          console.log("[push] token received:", token.value.slice(0, 16) + "...");
          const supabase = createClient();
          const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
          const { error } = await supabase.from("device_tokens").upsert(
            {
              user_id: userId,
              token: token.value,
              platform,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "token" }
          );
          if (error) {
            // eslint-disable-next-line no-console
            console.error("[push] upsert error:", error);
          }
        });

        await PushNotifications.addListener("registrationError", (err) => {
          // eslint-disable-next-line no-console
          console.error("[push] registration error:", err);
        });

        await PushNotifications.addListener(
          "pushNotificationReceived",
          (notification) => {
            // eslint-disable-next-line no-console
            console.log("[push] received:", notification);
            syncAppBadgeFromServer(userId);
          }
        );

        // pushNotificationActionPerformed はレイアウト側の <PushTapHandler /> で
        // 早期に登録するため、ここでは登録しない（cold start の取りこぼし防止）
      }

      // 3. 毎回 register() を呼び出してトークンを取得／更新
      //    iOS は register() 後に "registration" イベントが発火する
      await PushNotifications.register();
      lastRegisterAt = Date.now();

      // 4. 起動直後にバッジ同期
      syncAppBadgeFromServer(userId);

      // 5. アプリ復帰 (visibilitychange / focus) 時にもトークンを再登録
      //    バックグラウンドで長時間置かれた後にトークンが失効していても自動で復旧する
      if (!resumeListenerAdded) {
        resumeListenerAdded = true;
        const onResume = () => {
          if (typeof document === "undefined") return;
          if (document.visibilityState !== "visible") return;
          if (!Capacitor.isNativePlatform()) return;
          // クールダウン (連続イベント抑制)
          if (Date.now() - lastRegisterAt < REGISTER_COOLDOWN_MS) return;
          lastRegisterAt = Date.now();
          // eslint-disable-next-line no-console
          console.log("[push] re-registering on resume");
          PushNotifications.register().catch((e) => {
            // eslint-disable-next-line no-console
            console.error("[push] re-register error:", e);
          });
          // 同時にバッジも再同期
          syncAppBadgeFromServer(userId);
        };
        document.addEventListener("visibilitychange", onResume);
        window.addEventListener("focus", onResume);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[push] setup error:", err);
    } finally {
      // 次回の setup で再実行可能にする
      currentSetupPromise = null;
    }
  })();
  return currentSetupPromise;
}
