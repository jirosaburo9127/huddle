// Capacitor + Supabase によるネイティブプッシュ通知のセットアップ
// ネイティブ環境(iOS Capacitor)でのみ動作。Webブラウザでは何もしない。

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";

let registered = false;

/**
 * iOS アプリアイコンのバッジと通知センターの既配信通知をクリアする。
 * チャンネルを開いたとき・アプリがフォアグラウンドに戻ったときに呼ぶ。
 */
export async function clearPushBadge(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // プラグイン未対応など、失敗しても UI には影響しない
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] setup error:", err);
  }
}
