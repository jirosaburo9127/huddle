// Supabase Edge Function: みかん（AIファシリテーター）の返信生成
//
// トリガ: mentions テーブルへの INSERT (Database Webhook)
//   - mentioned_user_id がみかん bot の UUID であれば反応
//   - チャンネルが mikan_enabled = true でなければ無視
//
// 処理:
//   1) メッセージと文脈（直近50件）を取得
//   2) Anthropic Claude Haiku 4.5 にシステムプロンプト + 文脈 + ツール定義を投げる
//   3) Claude が `propose_event` ツールを呼んだら → 提案メッセージ投稿 + event_proposals に保存
//      (リアクションされたら DB トリガーで events に変換)
//   4) ツール呼び出しが無ければ通常のテキスト返信を投稿
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

# カレンダー登録ツール
ユーザーが具体的な日時を伴って予定/会議/打合せの登録を望んでいると判断した場合、\`propose_event\` ツールを呼んでください。
- タイトルと開始日時の両方が明確な場合のみ呼ぶ
- 日時が曖昧 (例: 「来週どこかで」「今度」) はツールを呼ばずに、口頭で日時を確認する質問を返す
- ツールを呼んだ場合は本文での説明は不要。ツール呼び出しだけで OK
- start_at_iso はタイムゾーン付きの ISO 8601 (例: "2026-05-04T15:00:00+09:00")。ユーザーが時刻を JST 前提で言っているなら +09:00 を付ける

# 出力形式
- 1回の返信は本文のみ。短く。
- 名前を呼ぶ時は表示名をそのまま使う
- 返信先のメッセージへの引用は不要（システム側で文脈付与する）`;

// Anthropic tool 定義: 予定登録の提案
const TOOLS = [
  {
    name: "propose_event",
    description:
      "ユーザーが予定/会議/打合せの登録を望んでいると判断した場合のみ呼ぶ。" +
      "タイトルと開始日時が明示されているか合理的に推測できる場合に限る。" +
      "曖昧な場合は呼ばずにテキストで確認質問を返すこと。",
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
  },
];

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

// 日時を日本語表記に整形 ("5月4日(土) 15:00")。フロントの formatDateTimeJa と同じ形式。
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // JST に変換 (UTC + 9h)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const m = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${month}月${day}日(${dow}) ${h}:${m}`;
}

// 現在の JST を文字列で
function nowJstString(): string {
  return formatDateTimeJa(new Date().toISOString());
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;

    if (payload.type !== "INSERT" || payload.table !== "mentions") {
      return new Response("ignored", { status: 200 });
    }
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
    if (msg.deleted_at) return new Response("message deleted", { status: 200 });
    // bot 自身の投稿には反応しない
    if (msg.user_id === MIKAN_USER_ID) return new Response("self message", { status: 200 });

    // チャンネル情報 (workspace_id も取得)
    const { data: ch } = await supabase
      .from("channels")
      .select("id, name, mikan_enabled, workspace_id")
      .eq("id", msg.channel_id)
      .maybeSingle();

    if (!ch || !ch.mikan_enabled) {
      return new Response("channel not enabled", { status: 200 });
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

    // Claude API 呼び出し (tools 付き)
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
        tools: TOOLS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
          // 現在日時はキャッシュ外。Claude が「明日3時」を絶対日時に解決するため
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

    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

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
        // ツール入力が壊れていたらフォールバック
        console.warn("[mikan] propose_event invalid input:", input);
      } else {
        // 提案メッセージを組み立て
        const jaDate = formatDateTimeJa(startAt.toISOString());
        const locLine = location ? `\n📍 ${location}` : "";
        const proposalContent =
          `📅 予定の登録を提案します\n\n「${title}」\n${jaDate}${locLine}\n\nこのメッセージにリアクションすると登録します ✅`;

        // みかんの提案メッセージを投稿
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

        // event_proposals に保存
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
          // 提案メッセージはすでに投下されているので、エラーでも 200 を返してリトライさせない
        }

        return new Response("proposal posted", { status: 200 });
      }
    }

    // 通常のテキスト返信
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
