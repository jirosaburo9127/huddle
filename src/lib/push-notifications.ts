// Capacitor + Supabase によるネイティブプッシュ通知のセットアップ
// ネイティブ環境(iOS Capacitor)でのみ動作。Webブラウザでは何もしない。

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { Badge } from "@capawesome/capacitor-badge";
import { createClient } from "@/lib/supabase/client";

let registered = false;

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
  if (registered) return;
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;

  registered = true;

  try {
    // 既存の権限状態を確認
    let permStatus = await PushNotifications.checkPermissions();

    // 未許可ならリクエスト
    if (permStatus.receive === "prompt") {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== "granted") {
      // ユーザーが拒否した場合は終了
      return;
    }

    // 登録成功時: トークンを Supabase に保存
    // ※リスナーは register() より先に登録する必要がある
    await PushNotifications.addListener("registration", async (token) => {
      // eslint-disable-next-line no-console
      console.log("[push] registration token received:", token.value.slice(0, 16) + "...");
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
        console.error("[push] device_tokens upsert error:", error);
      } else {
        // eslint-disable-next-line no-console
        console.log("[push] device_tokens upsert success");
      }
    });

    // 登録エラー
    await PushNotifications.addListener("registrationError", (err) => {
      // eslint-disable-next-line no-console
      console.error("[push] registration error:", err);
    });

    // 登録 (APNs/FCM への登録要求) - リスナー登録後に呼ぶ
    await PushNotifications.register();

    // フォアグラウンド受信時の挙動 (画面内に通知バナーを出すなどは別途実装可)
    await PushNotifications.addListener(
      "pushNotificationReceived",
      (notification) => {
        // eslint-disable-next-line no-console
        console.log("[push] received:", notification);
        // 受信即時にサーバ真実でバッジを再同期（APNs の badge 値は送信時点の値なので
        // 複数通知が立て続けに来ると古い数字が残ることがある）
        syncAppBadgeFromServer(userId);
      }
    );

    // 通知タップ時の挙動: APNs payload の url フィールドに従って画面遷移
    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action) => {
        // eslint-disable-next-line no-console
        console.log("[push] action:", action);
        const data = action.notification.data as { url?: string } | undefined;
        const url = data?.url;
        if (url && typeof window !== "undefined") {
          // ハードナビゲーションで遷移（SSRコンテンツを確実に取得するため）
          window.location.href = url;
        }
      }
    );

    // 起動直後にもサーバ真実でアイコンバッジを同期
    syncAppBadgeFromServer(userId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] setup error:", err);
  }
}
