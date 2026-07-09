// Supabase Edge Function: タスク担当者アサイン通知を APNs で配信
//
// データベーストリガー (task_assignees INSERT → notify_task_assignment) から
// 呼ばれる。タスクを割り当てられた担当者にプッシュ通知を送る。
// send-reaction-push と同型。

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

interface TaskAssignRecord {
  task_id: string;
  user_id: string;   // 担当に割り当てられた人 (通知先)
  actor_id: string;  // 割り当てた人
}

function formatDue(d: string): string {
  // d は 'YYYY-MM-DD'
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record: TaskAssignRecord | undefined = payload.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "no record" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    // 念のため: 自分自身へのアサインは通知しない
    if (record.user_id === record.actor_id) {
      return new Response(JSON.stringify({ skipped: "self assign" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 割り当てた人のプロフィール
    const { data: actor } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", record.actor_id)
      .maybeSingle();

    // タスク情報
    const { data: task } = await supabase
      .from("tasks")
      .select("title, channel_id, due_date")
      .eq("id", record.task_id)
      .maybeSingle();

    if (!task) {
      return new Response(JSON.stringify({ skipped: "task not found" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    // チャンネル情報 (通知タップ時の遷移先 workspace slug 用)
    const { data: channel } = await supabase
      .from("channels")
      .select("name, slug, workspace_id, workspaces(slug)")
      .eq("id", task.channel_id)
      .maybeSingle();

    const workspaceSlug =
      (channel as unknown as { workspaces?: { slug: string } | { slug: string }[] })
        ?.workspaces &&
      (Array.isArray(
        (channel as unknown as { workspaces: { slug: string } | { slug: string }[] }).workspaces
      )
        ? (channel as unknown as { workspaces: { slug: string }[] }).workspaces[0]?.slug
        : (channel as unknown as { workspaces: { slug: string } }).workspaces.slug);

    // タスク一覧 (マイタスク) へ遷移
    const taskUrl = workspaceSlug ? `/${workspaceSlug}/tasks` : "/";

    const recipientId = record.user_id;

    // デバイストークン取得
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("user_id", recipientId);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no tokens" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    // 未読バッジ数
    const { data: unreadData } = await supabase.rpc("get_unread_counts", {
      p_user_id: recipientId,
    });
    const badge = (unreadData as Array<{ unread_count: number }> || [])
      .reduce((sum, r) => sum + Number(r.unread_count || 0), 0);

    const actorName = actor?.display_name || "メンバー";
    const taskTitle = (task.title || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const dueText = task.due_date ? `（期限 ${formatDue(task.due_date)}）` : "";
    const title = `📋 ${actorName}がタスクを割り当て`;
    const body = `「${taskTitle}」${dueText}`;

    // APNs送信
    const jwt = await getApnsJwt();
    const results = await Promise.allSettled(
      tokens.map(async (t: { token: string }) => {
        const aps: Record<string, unknown> = {
          badge: badge || 1,
          alert: { title, body },
          sound: "default",
        };
        const response = await fetch(
          `https://${APNS_HOST}/3/device/${t.token}`,
          {
            method: "POST",
            headers: {
              authorization: `bearer ${jwt}`,
              "apns-topic": APNS_BUNDLE_ID,
              "apns-push-type": "alert",
              "content-type": "application/json",
              "apns-priority": "10",
            },
            body: JSON.stringify({ aps, url: taskUrl }),
          }
        );
        return { ok: response.ok, status: response.status };
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
    return new Response(
      JSON.stringify({ sent, total: tokens.length }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("send-task-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
