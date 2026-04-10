// Capacitor + Supabase によるネイティブプッシュ通知のセットアップ
// ネイティブ環境(iOS Capacitor)でのみ動作。Webブラウザでは何もしない。

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";

let registered = false;

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

    // 登録 (APNs/FCM への登録要求)
    await PushNotifications.register();

    // 登録成功時: トークンを Supabase に保存
    await PushNotifications.addListener("registration", async (token) => {
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
      }
    });

    // 登録エラー
    await PushNotifications.addListener("registrationError", (err) => {
      // eslint-disable-next-line no-console
      console.error("[push] registration error:", err);
    });

    // フォアグラウンド受信時の挙動 (画面内に通知バナーを出すなどは別途実装可)
    await PushNotifications.addListener(
      "pushNotificationReceived",
      (notification) => {
        // eslint-disable-next-line no-console
        console.log("[push] received:", notification);
      }
    );

    // 通知タップ時の挙動
    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action) => {
        // eslint-disable-next-line no-console
        console.log("[push] action:", action);
        // 将来的にはこの中で url にナビゲーションする
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] setup error:", err);
  }
}
