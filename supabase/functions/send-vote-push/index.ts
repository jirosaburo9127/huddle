// Supabase Edge Function: 投票回答の通知を APNs で配信
//
// Database Webhook (poll_votes テーブル INSERT) からトリガー。
// 投票を作成したユーザーに通知を送る。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID")!;
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID")!;
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID")!;
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY")!;
const APNS_ENV = Deno.env.get("APNS_ENV") ?? "development";
const APNS_HOST =
  APNS_ENV === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

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
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;
  const pemContents = APNS_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", binaryDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const header = { alg: "ES256", kid: APNS_KEY_ID };
  const payload = { iss: APNS_TEAM_ID, iat: now };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  cachedJwt = { token: jwt, expiresAt: now + 50 * 60 };
  return jwt;
}

interface VoteRecord {
  id: string;
  poll_id: string;
  user_id: string;
  option_index: number;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record: VoteRecord | undefined = payload.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "no record" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 投票者のプロフィール
    const { data: voter } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", record.user_id)
      .maybeSingle();

    // 投票の詳細 → メッセージ → チャンネル
    const { data: poll } = await supabase
      .from("polls")
      .select("message_id, channel_id, created_by, options")
      .eq("id", record.poll_id)
      .maybeSingle();

    if (!poll) {
      return new Response(JSON.stringify({ skipped: "poll not found" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    // 自分の投票には通知しない
    if (poll.created_by === record.user_id) {
      return new Response(JSON.stringify({ skipped: "self vote" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    // チャンネル情報
    const { data: channel } = await supabase
      .from("channels")
      .select("name, slug, workspace_id, workspaces(slug)")
      .eq("id", poll.channel_id)
      .maybeSingle();

    if (!channel) {
      return new Response(JSON.stringify({ skipped: "channel not found" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

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

    // 通知先: 投票作成者
    const recipientId = poll.created_by;

    // ミュート確認
    const { data: memberRow } = await supabase
      .from("channel_members")
      .select("muted")
      .eq("channel_id", poll.channel_id)
      .eq("user_id", recipientId)
      .maybeSingle();
    const isMuted = !!memberRow?.muted;

    // デバイストークン
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("user_id", recipientId);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no tokens" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    // 選択肢名
    const options = (typeof poll.options === "string" ? JSON.parse(poll.options) : poll.options) as string[];
    const optionLabel = options[record.option_index] || `選択肢${record.option_index + 1}`;

    const voterName = voter?.display_name || "メンバー";
    const title = `📊 ${voterName} が投票 (#${channel.name})`;
    const body = `「${optionLabel}」に投票しました`;
    const showBanner = !isMuted;

    // 未読バッジ数
    const { data: unreadData } = await supabase.rpc("get_unread_counts", {
      p_user_id: recipientId,
    });
    const badge = (unreadData as Array<{ unread_count: number }> || [])
      .reduce((sum, r) => sum + Number(r.unread_count || 0), 0);

    const jwt = await getApnsJwt();
    await Promise.allSettled(
      tokens.map(async (t: { token: string }) => {
        const aps: Record<string, unknown> = { badge: badge || 1 };
        if (showBanner) {
          aps.alert = { title, body };
          aps.sound = "default";
        }
        await fetch(`https://${APNS_HOST}/3/device/${t.token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": APNS_BUNDLE_ID,
            "apns-push-type": "alert",
            "content-type": "application/json",
            "apns-priority": showBanner ? "10" : "5",
          },
          body: JSON.stringify({ aps, url: channelUrl }),
        });
      })
    );

    return new Response(JSON.stringify({ sent: tokens.length }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("send-vote-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
