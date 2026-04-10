// Supabase Edge Function: 新着メッセージを APNs (iOS Push Notifications) で配信
//
// データベース Webhook (messages テーブル INSERT) からトリガーされる想定。
// 環境変数 (Supabase Secrets):
//   APNS_KEY_ID       : Apple Developer の APNs Auth Key ID (10文字)
//   APNS_TEAM_ID      : Apple Developer Team ID (10文字)
//   APNS_BUNDLE_ID    : iOS アプリの Bundle Identifier (com.jirosaburo.huddle)
//   APNS_PRIVATE_KEY  : .p8 ファイルの中身 (-----BEGIN PRIVATE KEY----- から -----END PRIVATE KEY----- まで)
//   SUPABASE_URL      : 自プロジェクトのURL (Supabaseが自動設定)
//   SUPABASE_SERVICE_ROLE_KEY : サービスロールキー (Supabaseが自動設定)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID")!;
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID")!;
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID")!;
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY")!;
// 送信先エンドポイント: development (Xcode Debugビルド) or production (TestFlight/App Store)
// デフォルトは development (sandbox)。TestFlight配布時に "production" に切り替える。
const APNS_ENV = Deno.env.get("APNS_ENV") ?? "development";
const APNS_HOST =
  APNS_ENV === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

// JWT は最大1時間有効。再生成コストを抑えるため50分キャッシュ
let cachedJwt: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(input: ArrayBuffer | string): string {
  let str: string;
  if (typeof input === "string") {
    str = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    str = btoa(binary);
  }
  return str.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) {
    return cachedJwt.token;
  }

  // .p8 (PKCS#8 PEM) を CryptoKey に変換
  const pemContents = APNS_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { alg: "ES256", kid: APNS_KEY_ID };
  const payload = { iss: APNS_TEAM_ID, iat: now };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = base64UrlEncode(signature);
  const jwt = `${signingInput}.${sigB64}`;
  cachedJwt = { token: jwt, expiresAt: now + 50 * 60 };
  return jwt;
}

async function sendPush(
  deviceToken: string,
  title: string,
  body: string,
  badge: number
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const jwt = await getApnsJwt();
    const response = await fetch(
      `https://${APNS_HOST}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": APNS_BUNDLE_ID,
          "apns-push-type": "alert",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: {
            alert: { title, body },
            sound: "default",
            badge,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, status: response.status, error: errorText };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

interface MessageRecord {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record: MessageRecord | undefined = payload.record;

    if (!record) {
      return new Response(JSON.stringify({ error: "no record" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // スレッド返信は通知対象外
    if (record.parent_id) {
      return new Response(JSON.stringify({ skipped: "thread reply" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 送信者プロフィール
    const { data: sender } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", record.user_id)
      .maybeSingle();

    // チャンネル情報
    const { data: channel } = await supabase
      .from("channels")
      .select("id, name, is_dm")
      .eq("id", record.channel_id)
      .maybeSingle();

    if (!channel) {
      return new Response(JSON.stringify({ error: "channel not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // チャンネルメンバー (送信者以外)
    const { data: members } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", record.channel_id)
      .neq("user_id", record.user_id);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ skipped: "no recipients" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const recipientIds = members.map((m) => m.user_id);

    // 各受信者の iOS デバイストークンを取得
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token, user_id")
      .in("user_id", recipientIds)
      .eq("platform", "ios");

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // 通知タイトル: DM は送信者名のみ、チャンネルは「送信者 (#チャンネル名)」
    const senderName = sender?.display_name || "メンバー";
    const title = channel.is_dm ? senderName : `${senderName} (#${channel.name})`;
    const body =
      record.content.length > 100
        ? record.content.slice(0, 100) + "…"
        : record.content;

    // 並列送信
    const results = await Promise.allSettled(
      tokens.map((t) => sendPush(t.token, title, body, 1))
    );

    // 送信失敗したトークンをログ出力 (410 Gone は無効トークン → 削除推奨)
    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && !r.value.ok) {
        failures.push(`${tokens[i].token.slice(0, 8)}... -> ${r.value.status} ${r.value.error}`);
        // 410 Gone なら DB から削除
        if (r.value.status === 410) {
          await supabase
            .from("device_tokens")
            .delete()
            .eq("token", tokens[i].token);
        }
      } else if (r.status === "rejected") {
        failures.push(`${tokens[i].token.slice(0, 8)}... -> rejected: ${r.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        sent: tokens.length - failures.length,
        failed: failures.length,
        failures: failures.length > 0 ? failures : undefined,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
