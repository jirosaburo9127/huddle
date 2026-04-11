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
  badge: number,
  url: string,
  isMention: boolean
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const jwt = await getApnsJwt();
    // メンション時は interruption-level を time-sensitive にして集中モードを突破する
    const aps: Record<string, unknown> = {
      alert: { title, body },
      sound: "default",
      badge,
    };
    if (isMention) {
      aps["interruption-level"] = "time-sensitive";
    }
    const response = await fetch(
      `https://${APNS_HOST}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": APNS_BUNDLE_ID,
          "apns-push-type": "alert",
          "content-type": "application/json",
          // チャットメッセージは即時配信優先なので常に 10（高優先度）。
          // 5 だと iOS がロック中にまとめて配信して遅延することがある。
          "apns-priority": "10",
        },
        body: JSON.stringify({
          aps,
          // カスタムデータ: 通知タップ時にクライアントが参照して画面遷移に使う
          url,
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

    // チャンネル情報 + ワークスペース slug (通知タップ時の遷移先URL生成用)
    const { data: channel } = await supabase
      .from("channels")
      .select("id, name, slug, is_dm, workspace_id, workspaces(slug)")
      .eq("id", record.channel_id)
      .maybeSingle();

    if (!channel) {
      return new Response(JSON.stringify({ error: "channel not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // 遷移先URL: /<workspace_slug>/<channel_slug>
    // workspaces はリレーションなので型があいまい → 安全にキャスト
    const workspaceSlug =
      (channel as unknown as { workspaces?: { slug: string } | { slug: string }[] })
        .workspaces &&
      (Array.isArray(
        (channel as unknown as { workspaces: { slug: string } | { slug: string }[] }).workspaces
      )
        ? (channel as unknown as { workspaces: { slug: string }[] }).workspaces[0]?.slug
        : (channel as unknown as { workspaces: { slug: string } }).workspaces.slug);
    const channelUrl =
      workspaceSlug && channel.slug ? `/${workspaceSlug}/${channel.slug}` : "/";

    // チャンネルメンバー (送信者以外) — ミュート状態も取得
    const { data: members } = await supabase
      .from("channel_members")
      .select("user_id, muted")
      .eq("channel_id", record.channel_id)
      .neq("user_id", record.user_id);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ skipped: "no recipients" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const recipientIds = members.map((m) => m.user_id);
    // user_id -> muted の引き当て用マップ（後段で @メンション以外は除外するのに使う）
    const mutedByUser = new Map<string, boolean>();
    for (const m of members) {
      mutedByUser.set(m.user_id, Boolean(m.muted));
    }

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

    // 受信者ごとの未読チャンネル数（バッジ数）を一括取得
    // get_unread_counts RPC で各ユーザーのチャンネル別未読を取得し、
    // チャンネル数 (>0のチャンネル数) + 1（新着） をバッジにする
    const badgeCountByUser = new Map<string, number>();
    for (const uid of new Set(recipientIds)) {
      const { data: unreadRows } = await supabase.rpc("get_unread_counts", {
        p_user_id: uid,
      });
      const unreadChannelCount = Array.isArray(unreadRows)
        ? (unreadRows as Array<{ unread_count: number }>).filter(
            (r) => Number(r.unread_count) > 0
          ).length
        : 0;
      // 今送ろうとしているメッセージが新しくunreadを生むため +1
      badgeCountByUser.set(uid, unreadChannelCount + 1);
    }

    // このメッセージでメンションされた user_id を取得
    // @here / @channel は全員宛として扱う
    const { data: mentionRows } = await supabase
      .from("mentions")
      .select("mentioned_user_id, mention_type")
      .eq("message_id", record.id);
    const mentionedUserIds = new Set<string>();
    let isBroadcastMention = false;
    for (const row of mentionRows || []) {
      if (row.mention_type === "here" || row.mention_type === "channel") {
        isBroadcastMention = true;
      } else if (row.mentioned_user_id) {
        mentionedUserIds.add(row.mentioned_user_id);
      }
    }

    const senderName = sender?.display_name || "メンバー";
    const bodyPlain =
      record.content.length > 100
        ? record.content.slice(0, 100) + "…"
        : record.content;

    // 受信者ごとに通知内容を組み立てる
    // - メンションされた人: 「🔔 sumika があなたをメンション (#general)」
    // - DM: 送信者名のみ
    // - 通常: 「sumika (#general)」
    function buildTitle(isMentioned: boolean): string {
      if (channel.is_dm) return senderName;
      if (isMentioned) {
        return `🔔 ${senderName} があなたをメンション (#${channel.name})`;
      }
      return `${senderName} (#${channel.name})`;
    }

    // ミュートされていて、かつ @メンションもされていないトークンは通知しない
    // Slackと同じ動作: ミュート中でも @メンションは常に通知する
    const targetedTokens = tokens.filter((t) => {
      const isMentioned =
        isBroadcastMention || mentionedUserIds.has(t.user_id);
      if (mutedByUser.get(t.user_id) && !isMentioned) return false;
      return true;
    });

    if (targetedTokens.length === 0) {
      return new Response(
        JSON.stringify({ skipped: "all recipients muted (no mention)" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // 並列送信
    const results = await Promise.allSettled(
      targetedTokens.map((t) => {
        const isMentioned =
          isBroadcastMention || mentionedUserIds.has(t.user_id);
        const badge = badgeCountByUser.get(t.user_id) ?? 1;
        return sendPush(
          t.token,
          buildTitle(isMentioned),
          bodyPlain,
          badge,
          channelUrl,
          isMentioned
        );
      })
    );

    // 送信失敗したトークンをログ出力 (410 Gone は無効トークン → 削除推奨)
    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && !r.value.ok) {
        failures.push(`${targetedTokens[i].token.slice(0, 8)}... -> ${r.value.status} ${r.value.error}`);
        // 410 Gone なら DB から削除
        if (r.value.status === 410) {
          await supabase
            .from("device_tokens")
            .delete()
            .eq("token", targetedTokens[i].token);
        }
      } else if (r.status === "rejected") {
        failures.push(`${targetedTokens[i].token.slice(0, 8)}... -> rejected: ${r.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        sent: targetedTokens.length - failures.length,
        muted_skipped: tokens.length - targetedTokens.length,
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
