// Supabase Edge Function: みかん（AIファシリテーター）の返信生成
//
// 2モード:
//  Mode A (mention): mentions テーブルへの INSERT が起点
//    - @みかん で呼ばれた時。会話 + ツール (propose_event) を渡し、
//      テキスト返信もしくは予定提案を投稿する。
//  Mode B (listen): messages テーブルへの INSERT が起点
//    - mikan-enabled チャンネルで誰かが投稿するたび呼ばれる。
//    - チャンネル内に最近 30 分以内の提案があればクールダウン。
//    - propose_event ツールのみ提供。テキスト返信は投稿しない (見守るだけ)。
//    - 直近の文脈で日時が確定したと判断した時のみ提案する。
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
const MODEL = "claude-haiku-4-5-20251001";
const CONTEXT_WINDOW_MESSAGES = 50;
const MAX_OUTPUT_TOKENS = 400;
// Listen モードのクールダウン (チャンネルあたり N 分以内に提案があればスキップ)
const LISTEN_COOLDOWN_MIN = 30;

// =============================================================================
// プロンプト
// =============================================================================

// Mode A: ファシリテーターとしての通常会話 + 予定登録
const SYSTEM_PROMPT_MENTION = `あなたは「みかん」というオンラインチームチャットのファシリテーター AI です。
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

# カレンダー登録ツール (propose_event)
ユーザーが予定/会議/打合せの登録を望んでいると判断した場合、\`propose_event\` ツールを呼んでください。
- ユーザーの今回の発言が「明日3時に打合せ」のように具体的でも、「登録お願い」「カレンダーに入れて」のように曖昧でも、**直近の文脈に日時とタイトルが揃っているなら呼ぶ**こと
- タイトルが曖昧で文脈にも見当たらない、もしくは日時が決まっていない場合は呼ばずに、口頭で確認の質問を返す
- ツールを呼んだ場合は本文での説明は不要。ツール呼び出しだけで OK
- start_at_iso はタイムゾーン付き ISO 8601 (例: "2026-05-04T15:00:00+09:00")。JST 前提なら +09:00 を付ける

# 出力形式
- 1回の返信は本文のみ。短く。
- 名前を呼ぶ時は表示名をそのまま使う
- 返信先のメッセージへの引用は不要（システム側で文脈付与する）`;

// Mode B: 見守りモード。テキスト返信はしない。提案 tool_use のみ
const SYSTEM_PROMPT_LISTEN = `あなたはオンラインチームチャットを見守る AI 「みかん」です。
今は「見守りモード」で、ユーザーから直接呼びかけられていません。

# このモードでの厳格なルール
1. **テキストでの返信は絶対にしない。** 何かを答えたいと思っても、テキスト出力は空にしてください
2. \`propose_event\` ツールを呼ぶのは、**会話の中で日時とタイトルが揃って合意・決定された直後** のみ
3. まだ調整中・候補出し中・「来週どこかで」のような曖昧な段階では絶対に呼ばない
4. 過去にすでに提案・確定済みの予定を再提案しない (文脈中に「📅」のメッセージが既にあれば呼ばない)
5. 単なる雑談、感想、報告、過去の予定への言及には反応しない

# 判断の基準 (両方 YES のときだけ呼ぶ)
- 直近のやり取りで「\\<具体的な日時\\> に \\<具体的な内容\\>」が確定している
- 参加者が反対していない / 同意のリアクション・返答がある (「OK」「了解」「いいよ」など)

# 出力形式
- ツールを呼ぶ場合: 本文テキストは出力しない (空)
- 呼ばない場合: 本文テキストも空。ツールも呼ばない。`;

// =============================================================================
// ツール定義
// =============================================================================

const PROPOSE_EVENT_TOOL = {
  name: "propose_event",
  description:
    "予定登録の提案メッセージを投稿する。タイトルと開始日時が明確なときのみ呼ぶ。",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "予定のタイトル (例: '会議', '○○さんとの打合せ')",
      },
      start_at_iso: {
        type: "string",
        description:
          "開始日時 ISO 8601 (タイムゾーン付き、例: '2026-05-04T15:00:00+09:00')。JST なら +09:00 を付ける。",
      },
      location: {
        type: "string",
        description: "場所 (任意)",
      },
    },
    required: ["title", "start_at_iso"],
  },
};

// =============================================================================
// 型
// =============================================================================

interface MentionPayload {
  type: "INSERT";
  table: "mentions";
  schema: string;
  record: {
    id: string;
    message_id: string;
    mentioned_user_id: string;
    mention_type: string;
  };
}

interface MessagePayload {
  type: "INSERT";
  table: "messages";
  schema: string;
  record: {
    id: string;
    channel_id: string;
    user_id: string;
    content: string;
    created_at: string;
  };
}

type WebhookPayload = MentionPayload | MessagePayload;

interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_id?: string | null;
  deleted_at?: string | null;
  profiles: { display_name: string } | null;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

// =============================================================================
// ユーティリティ
// =============================================================================

// 日時を日本語表記に整形 ("5月4日(土) 15:00")
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const m = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${month}月${day}日(${dow}) ${h}:${m}`;
}

function nowJstString(): string {
  return formatDateTimeJa(new Date().toISOString());
}

// =============================================================================
// メイン
// =============================================================================

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    if (payload.type !== "INSERT") {
      return new Response("ignored", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // モード判定 + 元メッセージ ID 抽出
    let messageId: string;
    let mode: "mention" | "listen";
    if (payload.table === "mentions") {
      if (payload.record.mentioned_user_id !== MIKAN_USER_ID) {
        return new Response("not mikan", { status: 200 });
      }
      messageId = payload.record.message_id;
      mode = "mention";
    } else if (payload.table === "messages") {
      messageId = payload.record.id;
      mode = "listen";
    } else {
      return new Response("ignored", { status: 200 });
    }

    // メッセージ本体取得
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .select("id, channel_id, user_id, content, created_at, parent_id, deleted_at, profiles(display_name)")
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr || !msg) return new Response("message not found", { status: 200 });
    if (msg.deleted_at) return new Response("message deleted", { status: 200 });
    if (msg.user_id === MIKAN_USER_ID) return new Response("self message", { status: 200 });

    // チャンネル情報
    const { data: ch } = await supabase
      .from("channels")
      .select("id, name, mikan_enabled, workspace_id")
      .eq("id", msg.channel_id)
      .maybeSingle();

    if (!ch || !ch.mikan_enabled) return new Response("channel not enabled", { status: 200 });

    // Listen モードのクールダウン: 直近 N 分以内に同チャンネルで提案があればスキップ
    if (mode === "listen") {
      const since = new Date(Date.now() - LISTEN_COOLDOWN_MIN * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("event_proposals")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", msg.channel_id)
        .gte("created_at", since);
      if ((count ?? 0) > 0) {
        return new Response("cooldown", { status: 200 });
      }
    }

    // 直近の文脈
    const { data: history } = await supabase
      .from("messages")
      .select("id, user_id, content, created_at, profiles(display_name)")
      .eq("channel_id", msg.channel_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_WINDOW_MESSAGES);

    const ctx = ((history ?? []) as unknown as MessageRow[]).slice().reverse();

    const conversation = ctx.map((m) => {
      const name =
        m.user_id === MIKAN_USER_ID
          ? "みかん"
          : (m.profiles?.display_name ?? "誰か");
      const isMikan = m.user_id === MIKAN_USER_ID;
      return {
        role: isMikan ? "assistant" : "user",
        content: isMikan ? m.content : `${name}: ${m.content}`,
      };
    });

    const lastUserName = msg.profiles?.display_name ?? "誰か";

    // モードに応じてシステムプロンプトとツール選択を切り替え
    const systemPrompt =
      mode === "mention" ? SYSTEM_PROMPT_MENTION : SYSTEM_PROMPT_LISTEN;

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
        tools: [PROPOSE_EVENT_TOOL],
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
          // 現在日時はキャッシュ外
          {
            type: "text",
            text: `現在日時 (JST): ${nowJstString()}`,
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
      return new Response(`ai failed: ${aiRes.status} ${errText}`, { status: 200 });
    }

    const aiJson = await aiRes.json() as { content: ContentBlock[] };

    // tool_use 優先で処理
    const toolBlock = aiJson.content.find(
      (c): c is Extract<ContentBlock, { type: "tool_use" }> =>
        c.type === "tool_use" && c.name === "propose_event"
    );

    if (toolBlock) {
      const input = toolBlock.input as { title?: unknown; start_at_iso?: unknown; location?: unknown };
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const startIso = typeof input.start_at_iso === "string" ? input.start_at_iso : "";
      const location = typeof input.location === "string" ? input.location.trim() : "";
      const startAt = new Date(startIso);

      if (!title || isNaN(startAt.getTime())) {
        console.warn("[mikan] propose_event invalid input:", input);
      } else {
        const jaDate = formatDateTimeJa(startAt.toISOString());
        const locLine = location ? `\n📍 ${location}` : "";
        const proposalContent =
          `📅 予定の登録を提案します\n\n「${title}」\n${jaDate}${locLine}\n\nこのメッセージにリアクションすると登録します ✅`;

        const { data: msgData, error: insertErr } = await supabase
          .from("messages")
          .insert({
            channel_id: msg.channel_id,
            user_id: MIKAN_USER_ID,
            content: proposalContent,
          })
          .select("id")
          .maybeSingle();

        if (insertErr || !msgData) {
          console.error("[mikan] proposal message insert failed:", insertErr);
          return new Response("insert failed", { status: 500 });
        }

        const { error: propErr } = await supabase.from("event_proposals").insert({
          workspace_id: ch.workspace_id,
          channel_id: msg.channel_id,
          message_id: msgData.id,
          proposed_by: MIKAN_USER_ID,
          for_user_id: msg.user_id,
          title,
          starts_at: startAt.toISOString(),
          location: location || null,
        });

        if (propErr) {
          console.error("[mikan] event_proposals insert failed:", propErr);
        }

        return new Response("proposal posted", { status: 200 });
      }
    }

    // Listen モードではテキスト返信は投稿しない
    if (mode === "listen") {
      return new Response("listen no-op", { status: 200 });
    }

    // Mention モード: 通常テキスト返信
    const replyText = aiJson.content
      .filter((c): c is Extract<ContentBlock, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    if (!replyText) {
      return new Response("empty reply", { status: 200 });
    }

    const { error: insertErr } = await supabase.from("messages").insert({
      channel_id: msg.channel_id,
      user_id: MIKAN_USER_ID,
      content: replyText,
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
