// Supabase Edge Function: みかん プロアクティブ介入
//
// 毎日 10:00 JST に pg_cron から呼ばれ、mikan_enabled チャンネルのうち
// 3日以上投稿がないものに対して、過去の会話を要約+問いかけで投稿する。
//
// 連続介入防止: みかん自身の最新投稿から3日以内のチャンネルはスキップ。
// 話題がない場合: LLM が空文字を返せば投稿しない。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MIKAN_WEBHOOK_SECRET = Deno.env.get("MIKAN_WEBHOOK_SECRET");
if (!MIKAN_WEBHOOK_SECRET) {
  throw new Error("MIKAN_WEBHOOK_SECRET env is required");
}

const MIKAN_SECRET_HEADER = "X-Mikan-Secret";
const MIKAN_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const MODEL = "claude-haiku-4-5-20251001";
const CONTEXT_WINDOW_MESSAGES = 50;
const MAX_OUTPUT_TOKENS = 2000;
// 3日 = 259200秒
const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

// =============================================================================
// プロンプト
// =============================================================================

const SYSTEM_PROMPT_PROACTIVE = `あなたは「みかん」というオンラインチームチャットのファシリテーター AI です。

# 状況
このチャンネルではここしばらく会話が止まっています。
あなたの役割は、直近の会話内容を踏まえて自然に話題を再開させることです。

# やること
1. 直近の会話の流れを短く要約する（1〜2行）
2. その続きとして、次のアクションや議論のきっかけになる問いかけをする（1〜2行）

# ルール
- 「お久しぶりです」「最近静かですね」「しばらく投稿がありませんが」など、停滞を指摘する表現は絶対に使わない
- あくまで話題の自然な続きとして切り出す。まるで昨日の会話の続きのように
- 柔らかい丁寧語。「ですます」調
- 合計2〜4行で短く
- 誰かを名指しで呼ばない（プレッシャーになる）
- 特定の人の意見を批判・評価しない
- 直近の会話に実質的な内容がない場合（挨拶だけ、テスト投稿だけ等）は「__SKIP__」とだけ返す
- 絵文字は1〜2個まで`;

// =============================================================================
// 型
// =============================================================================

interface ChannelRow {
  id: string;
  name: string;
  workspace_id: string;
}

interface MessageRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { display_name: string } | null;
}

// =============================================================================
// メイン
// =============================================================================

Deno.serve(async (req) => {
  try {
    // 認証
    const providedSecret = req.headers.get(MIKAN_SECRET_HEADER) ?? "";
    if (providedSecret !== MIKAN_WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const now = Date.now();
    const thresholdDate = new Date(now - STALE_THRESHOLD_MS).toISOString();

    // mikan_enabled な全チャンネルを取得
    const { data: channels, error: chErr } = await supabase
      .from("channels")
      .select("id, name, workspace_id")
      .eq("mikan_enabled", true)
      .eq("is_dm", false)
      .eq("is_hitorigoto", false);

    if (chErr || !channels) {
      console.error("[mikan-proactive] channels fetch failed:", chErr);
      return new Response("channels fetch failed", { status: 500 });
    }

    let processedCount = 0;
    let postedCount = 0;

    for (const ch of channels as ChannelRow[]) {
      // 直近のメッセージを確認（みかん以外の最新投稿）
      const { data: latestMsg } = await supabase
        .from("messages")
        .select("created_at")
        .eq("channel_id", ch.id)
        .neq("user_id", MIKAN_USER_ID)
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // メッセージが一つもない、またはまだ活発なチャンネルはスキップ
      if (!latestMsg) continue;
      if (new Date(latestMsg.created_at).getTime() > now - STALE_THRESHOLD_MS) continue;

      // みかん自身の最新投稿を確認 → 3日以内なら連続介入防止でスキップ
      const { data: latestMikanMsg } = await supabase
        .from("messages")
        .select("created_at")
        .eq("channel_id", ch.id)
        .eq("user_id", MIKAN_USER_ID)
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestMikanMsg && new Date(latestMikanMsg.created_at).getTime() > now - STALE_THRESHOLD_MS) {
        continue;
      }

      processedCount++;

      // 直近のメッセージをコンテキストとして取得
      const { data: history } = await supabase
        .from("messages")
        .select("id, user_id, content, created_at, profiles(display_name)")
        .eq("channel_id", ch.id)
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(CONTEXT_WINDOW_MESSAGES);

      const ctx = ((history ?? []) as unknown as MessageRow[]).slice().reverse();

      if (ctx.length === 0) continue;

      const conversation = ctx.map((m) => {
        const name = m.user_id === MIKAN_USER_ID
          ? "みかん"
          : (m.profiles?.display_name ?? "誰か");
        const isMikan = m.user_id === MIKAN_USER_ID;
        return {
          role: isMikan ? "assistant" as const : "user" as const,
          content: isMikan ? m.content : `${name}: ${m.content}`,
        };
      });

      // Claude API 呼び出し
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT_PROACTIVE,
          messages: conversation,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error(`[mikan-proactive] anthropic api failed for channel ${ch.name}:`, aiRes.status, errText);
        continue;
      }

      const aiJson = await aiRes.json() as {
        content: Array<{ type: string; text?: string }>;
      };

      const replyText = aiJson.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n")
        .trim();

      // 空文字または __SKIP__ なら投稿しない
      if (!replyText || replyText === "__SKIP__") {
        console.log(`[mikan-proactive] skipped channel ${ch.name} (no suitable topic)`);
        continue;
      }

      // チャンネルに投稿
      const { error: insertErr } = await supabase.from("messages").insert({
        channel_id: ch.id,
        user_id: MIKAN_USER_ID,
        content: replyText,
      });

      if (insertErr) {
        console.error(`[mikan-proactive] insert failed for channel ${ch.name}:`, insertErr);
        continue;
      }

      postedCount++;
      console.log(`[mikan-proactive] posted to channel ${ch.name}`);
    }

    const summary = `processed=${processedCount}, posted=${postedCount}, total_channels=${channels.length}`;
    console.log(`[mikan-proactive] done: ${summary}`);
    return new Response(summary, { status: 200 });
  } catch (e) {
    console.error("[mikan-proactive] unexpected error:", e);
    return new Response("error", { status: 500 });
  }
});
