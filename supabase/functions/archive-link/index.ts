// Supabase Edge Function: archive-link
//
// Database Webhook (messages INSERT) で起動。
// メッセージに URL が含まれていたら、お津会の「みんなでお勉強」チャンネルに
// 自動で転記する。
//
// 仕様:
//  - お津会専用 (LEARNING_CHANNEL_ID で固定)
//  - DM / 独り言 / みんなでお勉強自身 / みかん投稿 / 別 workspace は無視
//  - URL を Anthropic web_fetch で読み込み、1〜2 行の日本語概要を生成
//  - 「みんなでお勉強」へ「📎 概要 + URL + 出典」で転記
//  - 元メッセージに 📚 リアクション (転記済みの目印)
//  - 読み取れなかった URL は archive_pending に登録 + 投稿者に概要依頼
//  - 投稿者が次の発言で書いた概要を自動転記 (parent_id ではなく
//    archive_pending の resolved_at IS NULL を見て判定)
//
// 環境変数 (Supabase Secrets):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (自動)
//   SUPABASE_SERVICE_ROLE_KEY (自動)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIKAN_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
// お津会の「みんなでお勉強」チャンネル
const LEARNING_CHANNEL_ID = "1d3cb7bc-ea93-4b55-9f39-edac9c64be62";
const MODEL = "claude-haiku-4-5-20251001";

// 学習用転記の対象外にする (ドキュメント共有 / 社内コラボツール) ドメイン。
// 「あくまでも一般 Web サイトのリンクだけ転記」という運用方針。
// マッチ判定はホスト名ベース (URL.hostname と完全一致 or サブドメインで終わるか)。
const BLOCKED_ARCHIVE_DOMAINS: string[] = [
  // Google Workspace
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "drive.google.com",
  "forms.google.com",
  "calendar.google.com",
  "mail.google.com",
  "meet.google.com",
  "keep.google.com",
  // Microsoft 365 / Office
  "sharepoint.com",
  "onedrive.com",
  "onedrive.live.com",
  "office.com",
  "office.live.com",
  "outlook.com",
  "outlook.live.com",
  "teams.microsoft.com",
  "1drv.ms",
  // Notion
  "notion.so",
  "notion.site",
  // Apple iCloud
  "icloud.com",
  // クラウドストレージ
  "dropbox.com",
  "box.com",
  // ホワイトボード / デザイン
  "figma.com",
  "miro.com",
  "lucidchart.com",
  "lucid.app",
  "whimsical.com",
  // ドキュメントツール
  "coda.io",
  "quip.com",
  "evernote.com",
  // タスク管理
  "asana.com",
  "trello.com",
  "linear.app",
  "atlassian.net",
  "atlassian.com",
  "monday.com",
  "clickup.com",
  // チャット系
  "slack.com",
  "discord.com",
  "discord.gg",
  "chatwork.com",
];

function isBlockedArchiveDomain(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BLOCKED_ARCHIVE_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith("." + d),
  );
}

interface MessagePayload {
  type: "INSERT";
  table: "messages";
  schema: "public";
  record: {
    id: string;
    channel_id: string;
    user_id: string;
    content: string;
    parent_id: string | null;
    deleted_at: string | null;
  };
}

type SupabaseClient = ReturnType<typeof createClient>;

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as MessagePayload;

    if (payload.type !== "INSERT" || payload.table !== "messages") {
      return new Response("not target", { status: 200 });
    }

    const msg = payload.record;

    // ループ防止: みかん自身の投稿は無視
    if (msg.user_id === MIKAN_USER_ID) {
      return new Response("ignore mikan", { status: 200 });
    }
    // 再帰防止: 「みんなでお勉強」自身の投稿は無視
    if (msg.channel_id === LEARNING_CHANNEL_ID) {
      return new Response("ignore learning channel", { status: 200 });
    }
    if (msg.deleted_at) {
      return new Response("deleted", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // チャンネル情報 (DM / 独り言 / プライベート 除外、workspace 一致チェック)
    const { data: channel } = await supabase
      .from("channels")
      .select("id, name, slug, is_dm, is_hitorigoto, is_private, workspace_id")
      .eq("id", msg.channel_id)
      .maybeSingle();
    if (!channel) return new Response("channel not found", { status: 200 });
    if (channel.is_dm || channel.is_hitorigoto) {
      return new Response("dm or hitorigoto", { status: 200 });
    }
    // プライベートチャンネルは「招待されたメンバーだけが見られる」前提なので、
    // その内容を全員が見える #みんなでお勉強 に転記すると情報漏洩になる
    if (channel.is_private) {
      return new Response("private channel", { status: 200 });
    }

    const { data: learningCh } = await supabase
      .from("channels")
      .select("workspace_id")
      .eq("id", LEARNING_CHANNEL_ID)
      .maybeSingle();
    if (!learningCh || learningCh.workspace_id !== channel.workspace_id) {
      return new Response("different workspace", { status: 200 });
    }

    // 「#みんなでお勉強 の全メンバーが元チャンネルにも参加している」場合のみ転記。
    // これが成り立っていないと、元チャンネルに参加していない人が #みんなでお勉強
    // で投稿を見られてしまい、参加していないチャンネルの内容が漏れる。
    const { data: learningMembers } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", LEARNING_CHANNEL_ID);
    const { data: sourceMembers } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", msg.channel_id);
    const sourceMemberIds = new Set(
      (sourceMembers ?? []).map((r) => r.user_id as string),
    );
    const allLearningMembersInSource = (learningMembers ?? []).every((lm) =>
      sourceMemberIds.has(lm.user_id as string),
    );
    if (!allLearningMembersInSource) {
      return new Response("learning members not subset of source", { status: 200 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", msg.user_id)
      .maybeSingle();
    const userName = profile?.display_name ?? "メンバー";

    // URL 抽出 (Supabase Storage の chat-files URL は除外。さらにドキュメント
    // 共有系 / 社内コラボツール系も「学習用転記」の趣旨と合わないため除外)
    const urlRegex = /https?:\/\/[^\s<>"]+/g;
    const matches = msg.content.match(urlRegex) ?? [];
    const urls = matches
      .map(cleanTrailingPunctuation)
      .filter(
        (u) =>
          !u.includes("supabase.co/storage/") &&
          !isBlockedArchiveDomain(u),
      );

    if (urls.length > 0) {
      for (const url of urls) {
        await processUrl(supabase, {
          url,
          sourceMessage: msg,
          channelName: channel.name,
          userName,
        });
      }
      return new Response("processed urls", { status: 200 });
    }

    // URL なし → 概要返信モードかチェック
    const { data: pending } = await supabase
      .from("archive_pending")
      .select("*")
      .eq("channel_id", msg.channel_id)
      .eq("source_user_id", msg.user_id)
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pending) {
      const summary = msg.content.trim();
      if (summary.length > 0 && summary.length <= 500) {
        await archiveWithSummary(supabase, {
          url: pending.url as string,
          summary,
          channelName: channel.name,
          userName,
        });

        await supabase
          .from("archive_pending")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", pending.id);

        await addArchivedReaction(supabase, pending.source_message_id as string);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[archive-link] unexpected error:", e);
    return new Response("error", { status: 500 });
  }
});

function cleanTrailingPunctuation(url: string): string {
  // URL 末尾に付いた句読点や閉じ括弧を取り除く (誤抽出対策)
  return url.replace(/[)\]、。,.!！？?]+$/u, "");
}

async function processUrl(
  supabase: SupabaseClient,
  args: {
    url: string;
    sourceMessage: { id: string; channel_id: string; user_id: string };
    channelName: string;
    userName: string;
  },
) {
  const summary = await fetchAndSummarize(args.url);

  if (!summary) {
    // 取得失敗 → 概要依頼メッセージ + archive_pending 登録
    const requestText =
      `<@${args.sourceMessage.user_id}> このページの中身を読み取れませんでした 🙏\n\n` +
      `${args.url}\n\n` +
      `1〜2 行で概要を書いてもらえると、#みんなでお勉強 に転記します`;

    const { data: reqMsg } = await supabase
      .from("messages")
      .insert({
        channel_id: args.sourceMessage.channel_id,
        user_id: MIKAN_USER_ID,
        content: requestText,
      })
      .select("id")
      .maybeSingle();

    await supabase.from("archive_pending").insert({
      source_message_id: args.sourceMessage.id,
      source_user_id: args.sourceMessage.user_id,
      channel_id: args.sourceMessage.channel_id,
      url: args.url,
      request_message_id: reqMsg?.id ?? null,
    });
    return;
  }

  await archiveWithSummary(supabase, {
    url: args.url,
    summary,
    channelName: args.channelName,
    userName: args.userName,
  });

  await addArchivedReaction(supabase, args.sourceMessage.id);
}

async function archiveWithSummary(
  supabase: SupabaseClient,
  args: {
    url: string;
    summary: string;
    channelName: string;
    userName: string;
  },
) {
  const content =
    `📎 ${args.summary}\n${args.url}\n\n— ${args.userName} さんが #${args.channelName} に投稿`;

  await supabase.from("messages").insert({
    channel_id: LEARNING_CHANNEL_ID,
    user_id: MIKAN_USER_ID,
    content,
  });
}

async function addArchivedReaction(
  supabase: SupabaseClient,
  messageId: string,
) {
  await supabase.from("reactions").insert({
    message_id: messageId,
    user_id: MIKAN_USER_ID,
    emoji: "📚",
  });
}

async function fetchAndSummarize(url: string): Promise<string | null> {
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-fetch-2025-09-10",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 250,
      tools: [
        {
          type: "web_fetch_20250910",
          name: "web_fetch",
          max_uses: 1,
          max_content_tokens: 5000,
        },
      ],
      system:
        "あなたは Web ページの内容を 1〜2 行 (60〜120 文字) の日本語に要約するアシスタントです。" +
        "出力は要約文のみ。前置き・後置き・引用・URL は含めない。" +
        "ページの題名がそのまま内容を端的に表しているなら、題名 + 1 行説明でも OK。" +
        "404・タイムアウト・robots 拒否・有料壁・読み取れない場合は、本文を完全に空で返してください。",
      messages: [
        {
          role: "user",
          content:
            `次の URL を web_fetch ツールで読み込んで、本文を 1〜2 行で要約してください。\n\n${url}`,
        },
      ],
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("[archive-link] anthropic api failed:", aiRes.status, errText);
    return null;
  }

  const aiJson = (await aiRes.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = aiJson.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();

  if (!text || text.length < 5) return null;
  return text;
}
