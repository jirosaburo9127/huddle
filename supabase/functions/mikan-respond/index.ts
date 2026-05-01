// Supabase Edge Function: みかん（AIファシリテーター）の返信生成
//
// トリガ: mentions テーブルへの INSERT (Database Webhook)
//   - mentioned_user_id がみかん bot の UUID であれば反応
//   - チャンネルが mikan_enabled = true でなければ無視
//
// 処理:
//   1) メッセージと文脈（直近50件）を取得
//   2) Anthropic Claude Haiku 4.5 にシステムプロンプト + 文脈を投げる
//   3) 返答を「みかん」bot として messages に INSERT
//
// 環境変数 (Supabase Secrets):
//   ANTHROPIC_API_KEY        : Anthropic Console で発行する API キー
//   SUPABASE_URL             : 自動設定
//   SUPABASE_SERVICE_ROLE_KEY: 自動設定 (RLS バイパスして書き込みする)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIKAN_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const MODEL = "claude-haiku-4-5";
const CONTEXT_WINDOW_MESSAGES = 50;
const MAX_OUTPUT_TOKENS = 400;

// みかんの人格・ふるまいを定義するシステムプロンプト
// 「柔らかい中立者」として、責めず、誰の味方でもなく、場を整える役
const SYSTEM_PROMPT = `あなたは「みかん」というオンラインチームチャットのファシリテーター AI です。
以下の役割と性格を厳守してください。

# 役割
- グループ全体を見渡し、安心して参加できる場を保つ
- 発言が一部に偏らないよう、自然に他の人にも話を振る
- 感情的なやり取りになりそうな時、間に入って和らげる
- 議論が堂々巡りになっていれば、論点を整理して次の行動を提案する
- 質問されたら短く答え、議論には踏み込みすぎない

# 性格・トーン
- 柔らかい丁寧語。「ですます」調
- 誰の味方でもなく中立的。否定・断定は避ける
- 短く話す。長い説教はしない（最大3〜4行）
- 絵文字は使っても1メッセージに1〜2個まで
- 自分の意見を強く押し付けない。「〜という見方もあるかもしれません」「〜してみるのはどうでしょう」など提案形

# 禁止事項
- 誰かを批判・評価しない
- 個人を特定して責めるような表現
- 「みなさん」「全員」など強い呼びかけ（特定の人を取り残す可能性）
- 過剰な励まし・お世辞
- 政治・宗教・センシティブな話題への踏み込み

# 出力形式
- 1回の返信は本文のみ。短く。
- 名前を呼ぶ時は表示名をそのまま使う
- 返信先のメッセージへの引用は不要（システム側で文脈付与する）`;

interface WebhookPayload {
  type: "INSERT";
  table: string;
  schema: string;
  record: {
    id: string;
    message_id: string;
    mentioned_user_id: string;
    mention_type: string;
  };
  old_record: null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
  deleted_at: string | null;
  profiles: { display_name: string } | null;
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;

    // mentions への INSERT のみ処理
    if (payload.type !== "INSERT" || payload.table !== "mentions") {
      return new Response("ignored", { status: 200 });
    }

    // みかんへのメンションのみ処理
    if (payload.record.mentioned_user_id !== MIKAN_USER_ID) {
      return new Response("not mikan", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // メッセージ本体取得
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .select("id, channel_id, user_id, content, created_at, parent_id, deleted_at, profiles(display_name)")
      .eq("id", payload.record.message_id)
      .maybeSingle();

    if (msgErr || !msg) {
      console.error("[mikan] message fetch failed:", msgErr);
      return new Response("message not found", { status: 200 });
    }

    if (msg.deleted_at) {
      return new Response("message deleted", { status: 200 });
    }

    // bot 自身の投稿には反応しない（無限ループ防止）
    if (msg.user_id === MIKAN_USER_ID) {
      return new Response("self message", { status: 200 });
    }

    // チャンネルが mikan_enabled か確認
    const { data: ch } = await supabase
      .from("channels")
      .select("id, name, mikan_enabled")
      .eq("id", msg.channel_id)
      .maybeSingle();

    if (!ch || !ch.mikan_enabled) {
      return new Response("channel not enabled", { status: 200 });
    }

    // 直近の文脈を取得（昇順で揃える）
    const { data: history } = await supabase
      .from("messages")
      .select("id, user_id, content, created_at, profiles(display_name)")
      .eq("channel_id", msg.channel_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_WINDOW_MESSAGES);

    const ctx = ((history ?? []) as unknown as MessageRow[]).slice().reverse();

    // 文脈を会話形式に整形
    const conversation = ctx
      .map((m) => {
        const name =
          m.user_id === MIKAN_USER_ID
            ? "みかん"
            : (m.profiles?.display_name ?? "誰か");
        // bot 含めて全員 user role で渡し、アシスタント発話は role: "assistant" にする
        const isMikan = m.user_id === MIKAN_USER_ID;
        return {
          role: isMikan ? "assistant" : "user",
          content: isMikan ? m.content : `${name}: ${m.content}`,
        };
      });

    // 末尾の最新メッセージは「みかんへの問いかけ」として明示
    const lastUserName = msg.profiles?.display_name ?? "誰か";

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
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: conversation.length > 0 ? conversation : [
          { role: "user", content: `${lastUserName}: ${msg.content}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[mikan] anthropic api failed:", aiRes.status, errText);
      return new Response("ai failed", { status: 200 });
    }

    const aiJson = await aiRes.json() as {
      content: { type: string; text: string }[];
    };

    const replyText = aiJson.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    if (!replyText) {
      return new Response("empty reply", { status: 200 });
    }

    // みかんの返信を messages に挿入（mentions テーブルには入れない=他者通知不要）
    const { error: insertErr } = await supabase.from("messages").insert({
      channel_id: msg.channel_id,
      user_id: MIKAN_USER_ID,
      content: replyText,
      // 返信元へのスレッド化はせず、トップレベル投稿として流す（PoC ではシンプルに）
    });

    if (insertErr) {
      console.error("[mikan] insert reply failed:", insertErr);
      return new Response("insert failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[mikan] unexpected error:", e);
    return new Response("error", { status: 500 });
  }
});
