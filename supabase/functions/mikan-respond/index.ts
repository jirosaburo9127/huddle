// Supabase Edge Function: みかん（AIファシリテーター）の返信生成
//
// 動作モード: mention のみ (ユーザー起点)
//   - mentions テーブルへの INSERT が起点。@みかん で呼ばれた時に
//     会話 + 4 つのツール (propose_event / set_event_reminder / web_search /
//     web_fetch) を渡し、テキスト返信もしくは予定提案を投稿する。
//   - 予定登録の一次判断 (場所未確認・過去日・日時不明なら確認質問を返す)
//     は LLM のシステムプロンプトで誘導する想定。コード側にも保険フィルタは
//     置かない。LLM が誤判定したらユーザーがその場で訂正できる前提。
//   - したがって「期待した振る舞い」であり、強い実装保証ではない点に注意。
//
// 旧 messages テーブル INSERT 起点 (自動見守り = 旧 Mode B) は廃止済み。
//   - 理由: 自動モードは「保険フィルタ禁止」方針と相性が悪く、重複防止や
//     場所未確認 skip などのコード側バリデーションを後付けで積む方向に
//     走ってしまうため。ユーザー起点の Mode A 1 本に絞った。
//   - DB 側のトリガー (messages_mikan_listen_trigger / notify_mikan_listen)
//     は migration 117 で DROP 済み。Edge Function 側でも messages payload は
//     早期 return で受け付けない (Webhook が残っていても no-op)。
//
// 環境変数 (Supabase Secrets):
//   ANTHROPIC_API_KEY        : Anthropic Console で発行する API キー
//   SUPABASE_URL             : 自動設定
//   SUPABASE_SERVICE_ROLE_KEY: 自動設定 (RLS バイパスして書き込みする)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// notify_mikan_mention() trigger (migration 118) が X-Mikan-Secret ヘッダで送る
// 共有 secret。Supabase Vault に同じ値を保管している。
// 起動時に必須化: 未設定なら module init で throw し、インスタンスを上げない。
// (`?? ""` フォールバックだと、検証側の単純比較で空ヘッダ一致のリスクを論理層に
//  押し付けることになるため、ここで fail-fast する)
const MIKAN_WEBHOOK_SECRET = Deno.env.get("MIKAN_WEBHOOK_SECRET");
if (!MIKAN_WEBHOOK_SECRET) {
  throw new Error("MIKAN_WEBHOOK_SECRET env is required");
}
// ヘッダ名は typo 防止のため定数化 (DB トリガー側 migration 118 と一致させること)
const MIKAN_SECRET_HEADER = "X-Mikan-Secret";

const MIKAN_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const MODEL = "claude-haiku-4-5-20251001";
const CONTEXT_WINDOW_MESSAGES = 50;
// Haiku 4.5 の上限 8192 に近い値。論文整理など長文要請に応えるため拡張。
const MAX_OUTPUT_TOKENS = 8000;
// Web 検索の最大呼び出し回数 (1メッセージ当たり)。コスト上限の意味も持つ。
const WEB_SEARCH_MAX_USES = 5;

// =============================================================================
// プロンプト
// =============================================================================

// 盛り上がっている会話に自然に参加する (active_discussion 起点)
const SYSTEM_PROMPT_ACTIVE_DISCUSSION = `あなたは「みかん」というオンラインチームチャットのファシリテーター AI です。
このチャンネルでは今、活発な会話が行われています。
あなたの役割は、会話の流れに自然に参加し、議論を整理したり有用な情報を提供することです。

# やること（以下から最適なものを1つ選ぶ）
- 議論が散らばっている場合: 論点を整理する（「ここまでの論点をまとめると①… ②… ですね」）
- 意見が対立している場合: 両方の良い点を認めつつ、共通点や折衷案を提示する
- 情報が不足している場合: 関連する事実やデータを調べて提供する
- 次のアクションが不明確な場合: 具体的な次のステップを提案する
- 盛り上がっている話題をさらに深める質問をする

# ルール
- 柔らかい丁寧語。「ですます」調
- 2〜4行で短く。長い説教はしない
- 誰の味方でもなく中立的
- 特定の人を名指しで批判しない
- 「みなさん」「全員」など強い呼びかけは避ける
- 会話の邪魔にならないよう、的確に短く
- 絵文字は1〜2個まで
- 会話の内容が挨拶やテスト投稿など実質的でない場合は「__SKIP__」とだけ返す

# 出力形式
- 1回の返信は本文のみ。短く。
- 返信先のメッセージへの引用は不要`;

// ファシリテーターとしての通常会話 + 予定登録 (mention 起点)
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
- ツールを呼んだ場合は本文での説明は不要。ツール呼び出しだけで OK
- start_at_iso はタイムゾーン付き ISO 8601 (例: "2026-05-04T15:00:00+09:00")。JST 前提なら +09:00 を付ける

## 呼ばずに確認質問を返すべきケース (重要)
以下のいずれかに当てはまる場合は、\`propose_event\` を呼ばずに、足りない情報を 1〜2 行で
やさしく聞き返してください (例: 「場所はどちらにしましょう？」「日付は何月何日でしょう？」)。

1. **日時が決まっていない**: 「来週どこかで」「今度」「いつかやろう」など具体時刻が無い
2. **日時の解釈が複数ある**: 「金曜」が今週か来週か文脈で確定できない、「3時」が朝か昼か不明 など
3. **過去の日時**: 推定した start_at が現在日時より前になる
   - ただし「昨日の打合せ良かった」のような感想は、そもそも登録不要なので何も呼ばないし聞き返しもしない
4. **場所が話題に上ったのに未確定**: 会話の流れで「どこでやる？」「店どこ？」のように場所が論点に
   なっているのに決まっていない場合 (場所が一切話題に出ていないなら、location 無しで登録して OK)
5. **タイトルが曖昧で文脈にも見当たらない**: 何の予定か推測できない

上記に当てはまらず、タイトル + 日時 (+ 必要なら場所) が揃ったら、迷わずツールを呼んでください。

# リマインド変更ツール (set_event_reminder)
ユーザーが既に登録済みの予定について「30分前にリマインドして」「リマインドを1日前に変えて」など、
リマインドのタイミングを指定/変更したいと言ったら \`set_event_reminder\` ツールを呼んでください。
- ユーザーが分/時間/日 を言ったら分単位の整数に変換 (1日=1440, 1時間=60, 30分=30)
- 対象が曖昧なら title_hint は省略 (チャンネル内の直近の未来イベントが対象になる)
- 「「打合せ」を1時間前に」のように特定のイベント名を言ったら title_hint にその名前を渡す
- ツール呼び出し成功後はシステムが確認メッセージを出すので、テキストでの説明は不要

# Web ツール (web_search / web_fetch)
あなたは 2 種類の Web ツールを使えます。記憶だけで答えるのが危険な内容、最新情報、
固有名詞、統計、公式情報、ユーザーが貼った URL の中身などは **遠慮なくツールを使ってください**。

## ツールの使い分け
- **web_search** : キーワードから情報を探す時 (最大 5 回/メッセージ)
- **web_fetch** : 既知の URL を直接読み込みたい時 (最大 5 URL/メッセージ)

## 検索すべき場面 (web_search)
- 「○○について調べて」「○○とは？」と聞かれた時
- 「最近の○○」「△△の動向」など現在進行中の話題
- 「他にアイディアない？」「みかんはどう思う？」のような開かれた問いかけ
  → 会話の流れに関連する外部情報を検索して、それを踏まえてアイディアを羅列する

## URL を直接読む場面 (web_fetch)
- ユーザーがメッセージに URL を貼って言及した時 (「このページ何？」「読み込める？」「これ見て」など)
- 検索で見つけた URL の中身を実際に確認したい時
- 「ホームページは読み込めないかな？」のように、URL の中身を期待された時
  → かつてのみかんは「閲覧機能を持っていない」と返していたが、今は web_fetch で読める。
    URL を貼られたら必ず web_fetch を呼ぶ。

## 一次情報優先 (重要)
引用は必ず以下の優先順位で:
① 学会・大学・公的機関 (.ac.jp / .go.jp / .or.jp / .edu / .gov)
② 企業の自社発表 (公式プレスリリース・IR・自社サイト)
③ 査読論文・公式統計 (J-STAGE, PubMed, CiNii, e-Stat 等)

キュレーションメディア・まとめサイト・個人ブログ・SNS の引用は **避けてください**。
信頼できる一次情報が見つからない場合は素直に「公式情報が確認できませんでした」と書き、
推測のアイディアと事実情報を文章中で明確に分けてください。

## 引用フォーマット (重要)
返信の本文を書き終わったあと、参照した一次情報を文末にコンパクトに付けてください:

📚 参考:
・[出典名](URL)
・[出典名](URL)

最大 5 件まで。ドメインが見える形で。

# 出力形式
- 1回の返信は本文のみ。短く。
- 名前を呼ぶ時は表示名をそのまま使う
- 返信先のメッセージへの引用は不要（システム側で文脈付与する）`;

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

// Anthropic 公式の Web 検索 server tool。
// API 内部で検索が完結するので、こちらで tool_use の往復処理を書く必要はない。
// blocked_domains でまとめサイト/SNS を最小限弾き、一次情報優先はプロンプトで誘導する。
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: WEB_SEARCH_MAX_USES,
  blocked_domains: [
    "matome.naver.jp",
    "togetter.com",
    "5ch.net",
    "2ch.net",
    "girlschannel.net",
    "twitter.com",
    "x.com",
    "reddit.com",
  ],
};

// Anthropic の Web Fetch server tool (β)。
// ユーザーが貼った URL を直接 fetch して中身を読み込めるようにする。
// 1メッセージ当たり最大 5 URL、コンテンツは 5000 トークン (=約3500文字) で
// 切り詰めて返答 max_tokens (8000) を圧迫しないようにする。
const WEB_FETCH_TOOL = {
  type: "web_fetch_20250910",
  name: "web_fetch",
  max_uses: 5,
  max_content_tokens: 5000,
};

const SET_EVENT_REMINDER_TOOL = {
  name: "set_event_reminder",
  description:
    "登録済みイベントのリマインドのタイミング (何分前) を変更する。" +
    "ユーザーが「30分前にリマインドして」「リマインドを 1 時間前に」など、" +
    "登録済み予定のリマインドを変えたいと言ったら呼ぶ。" +
    "対象イベントを特定するためのヒント (タイトルの一部) を任意で渡せる。" +
    "ヒントが無ければチャンネル内の直近の未来イベントを対象とする。",
  input_schema: {
    type: "object",
    properties: {
      offset_minutes: {
        type: "integer",
        description:
          "イベント開始の何分前にリマインドを出すか。1440=1日、60=1時間、30=30分など。0 を指定するとリマインド無効。",
      },
      title_hint: {
        type: "string",
        description:
          "対象イベントのタイトル (部分一致)。指定しないとチャンネル内の直近の未来イベント。",
      },
    },
    required: ["offset_minutes"],
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

interface ActiveDiscussionPayload {
  type: "INSERT";
  table: "active_discussion";
  schema: string;
  record: {
    channel_id: string;
    message_id: string;
    msg_count: number;
    user_count: number;
  };
}

type WebhookPayload = MentionPayload | ActiveDiscussionPayload | { type: string; table: string };

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
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  // Anthropic 公式 server tool 系: web_search / web_fetch が API 内部で生成するブロック。
  // 我々はこれらを処理しない (server-side で完結する) が、レスポンスには含まれる
  | { type: "server_tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "web_search_tool_result"; tool_use_id: string; content: unknown }
  | { type: "web_fetch_tool_result"; tool_use_id: string; content: unknown };

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

// ILIKE のワイルドカード (%, _) と区切り文字 (\) を全て \-エスケープする。
// LLM が title_hint に「%会議%」「会_議」を返した時に、PostgreSQL の LIKE が
// ワイルドカード解釈してしまうのを防ぐ。
function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// =============================================================================
// メイン
// =============================================================================

Deno.serve(async (req) => {
  try {
    // 認証: notify_mikan_mention() トリガー (migration 118) が
    // Vault の `mikan_webhook_secret` を取り出して X-Mikan-Secret ヘッダで
    // 送ってくる。Edge Function 側はそれと MIKAN_WEBHOOK_SECRET (Supabase
    // Secrets) を突合して、不一致は 401。これで anon JWT を持っただけの
    // 外部リクエストからの濫用 (Anthropic API 料金浪費) を防ぐ。
    //
    // 旧 Authorization Bearer 厳密一致アプローチは Supabase Cloud で
    // `current_setting('supabase.service_role_key', true)` が空文字を返す問題
    // で 401 全弾きになるため不採用。huddle-supabase-gotchas 項目 9 参照。
    //
    // env 欠落チェックは module init で済ませている (この時点で空文字は来ない)。
    const providedSecret = req.headers.get(MIKAN_SECRET_HEADER) ?? "";
    if (providedSecret !== MIKAN_WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = (await req.json()) as WebhookPayload;
    if (payload.type !== "INSERT") {
      return new Response("ignored", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // active_discussion: 盛り上がっている会話への自動参加
    if (payload.table === "active_discussion") {
      const adPayload = payload as ActiveDiscussionPayload;
      const channelId = adPayload.record.channel_id;

      // チャンネル情報
      const { data: adCh } = await supabase
        .from("channels")
        .select("id, name, mikan_enabled")
        .eq("id", channelId)
        .maybeSingle();
      if (!adCh || !adCh.mikan_enabled) return new Response("channel not enabled", { status: 200 });

      // 直近の文脈
      const { data: adHistory } = await supabase
        .from("messages")
        .select("id, user_id, content, created_at, profiles(display_name)")
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(CONTEXT_WINDOW_MESSAGES);

      const adCtx = ((adHistory ?? []) as unknown as MessageRow[]).slice().reverse();
      if (adCtx.length === 0) return new Response("no context", { status: 200 });

      const adConversation = adCtx.map((m) => {
        const name = m.user_id === MIKAN_USER_ID
          ? "みかん"
          : (m.profiles?.display_name ?? "誰か");
        const isMikan = m.user_id === MIKAN_USER_ID;
        return {
          role: isMikan ? "assistant" as const : "user" as const,
          content: isMikan ? m.content : `${name}: ${m.content}`,
        };
      });

      const adAiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-fetch-2025-09-10",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
          system: [
            { type: "text", text: SYSTEM_PROMPT_ACTIVE_DISCUSSION, cache_control: { type: "ephemeral" } },
            { type: "text", text: `現在日時 (JST): ${nowJstString()}` },
          ],
          messages: adConversation,
        }),
      });

      if (!adAiRes.ok) {
        const errText = await adAiRes.text();
        console.error("[mikan] active_discussion api failed:", adAiRes.status, errText);
        return new Response("ai failed", { status: 200 });
      }

      const adAiJson = await adAiRes.json() as { content: ContentBlock[] };
      const adReplyText = adAiJson.content
        .filter((c): c is Extract<ContentBlock, { type: "text" }> => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      if (!adReplyText || adReplyText === "__SKIP__") {
        return new Response("skipped (no suitable topic)", { status: 200 });
      }

      await supabase.from("messages").insert({
        channel_id: channelId,
        user_id: MIKAN_USER_ID,
        content: adReplyText,
      });

      console.log(`[mikan] active_discussion posted to ${adCh.name} (${adPayload.record.msg_count} msgs, ${adPayload.record.user_count} users)`);
      return new Response("active_discussion ok", { status: 200 });
    }

    // mention 起点のみ受け付ける。messages テーブル INSERT (旧 Mode B) は捨てる
    if (payload.table !== "mentions") {
      return new Response("ignored (mode B removed)", { status: 200 });
    }
    const mentionPayload = payload as MentionPayload;
    if (mentionPayload.record.mentioned_user_id !== MIKAN_USER_ID) {
      return new Response("not mikan", { status: 200 });
    }
    const messageId = mentionPayload.record.message_id;

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

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        // web_fetch は β なので専用ヘッダを付ける
        "anthropic-beta": "web-fetch-2025-09-10",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, PROPOSE_EVENT_TOOL, SET_EVENT_REMINDER_TOOL],
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT_MENTION,
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

    // tool_use を順番に処理
    const reminderToolBlock = aiJson.content.find(
      (c): c is Extract<ContentBlock, { type: "tool_use" }> =>
        c.type === "tool_use" && c.name === "set_event_reminder"
    );

    if (reminderToolBlock) {
      const input = reminderToolBlock.input as {
        offset_minutes?: unknown;
        title_hint?: unknown;
      };
      const offsetMin = typeof input.offset_minutes === "number"
        ? Math.round(input.offset_minutes)
        : NaN;
      const titleHint = typeof input.title_hint === "string"
        ? input.title_hint.trim()
        : "";

      if (isNaN(offsetMin) || offsetMin < 0) {
        await supabase.from("messages").insert({
          channel_id: msg.channel_id,
          user_id: MIKAN_USER_ID,
          content: "リマインドのオフセットがうまく解釈できませんでした 🙏",
        });
        return new Response("invalid offset", { status: 200 });
      }

      // 対象イベントを検索
      let q = supabase.from("events")
        .select("id, title, start_at, reminder_offsets")
        .eq("channel_id", msg.channel_id)
        .gt("start_at", new Date().toISOString())
        .order("start_at", { ascending: true })
        .limit(1);
      if (titleHint) {
        q = q.ilike("title", `%${escapeLikePattern(titleHint)}%`);
      }
      const { data: events, error: evErr } = await q;

      if (evErr) {
        console.error("[mikan] event lookup failed:", evErr);
        return new Response("lookup failed", { status: 500 });
      }
      if (!events || events.length === 0) {
        const reason = titleHint
          ? `「${titleHint}」に該当する予定が見つかりませんでした`
          : "このチャンネルに今後の予定が見つかりませんでした";
        await supabase.from("messages").insert({
          channel_id: msg.channel_id,
          user_id: MIKAN_USER_ID,
          content: `${reason} 🤔`,
        });
        return new Response("event not found", { status: 200 });
      }

      const targetEvent = events[0] as { id: string; title: string; start_at: string };

      // reminder_offsets を更新 (失敗したらユーザーに失敗を返す)
      const newOffsets = offsetMin === 0 ? [] : [offsetMin];
      const { error: updateErr } = await supabase.from("events")
        .update({ reminder_offsets: newOffsets })
        .eq("id", targetEvent.id);
      if (updateErr) {
        console.error("[mikan] events update failed:", updateErr);
        await supabase.from("messages").insert({
          channel_id: msg.channel_id,
          user_id: MIKAN_USER_ID,
          content: "リマインドの設定変更に失敗しました 🙏",
        });
        return new Response("update failed", { status: 500 });
      }

      // 既発火履歴を該当 event について全部削除 (新オフセットで再発火できるように)。
      // 失敗しても致命的ではない (新オフセットが過去側だと再発火されないだけ) ので
      // 警告ログだけ残して処理は続行する。
      const { error: deleteErr } = await supabase.from("event_reminder_fires")
        .delete()
        .eq("event_id", targetEvent.id);
      if (deleteErr) {
        console.warn("[mikan] event_reminder_fires delete failed (non-fatal):", deleteErr);
      }

      // ラベル整形
      let label: string;
      if (offsetMin === 0) {
        label = "オフ";
      } else if (offsetMin >= 1440 && offsetMin % 1440 === 0) {
        label = `${offsetMin / 1440}日前`;
      } else if (offsetMin >= 60 && offsetMin % 60 === 0) {
        label = `${offsetMin / 60}時間前`;
      } else {
        label = `${offsetMin}分前`;
      }

      const confirmText = offsetMin === 0
        ? `「${targetEvent.title}」のリマインドを無効にしました`
        : `「${targetEvent.title}」のリマインドを ${label} に設定しました ⏰`;

      await supabase.from("messages").insert({
        channel_id: msg.channel_id,
        user_id: MIKAN_USER_ID,
        content: confirmText,
      });

      return new Response("reminder updated", { status: 200 });
    }

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

        // event_proposals INSERT に失敗したら、孤児メッセージ (リアクションしても
        // 登録できない 📅 メッセージ) が残らないように、先に投稿した messages を
        // 削除してロールバックする。
        if (propErr) {
          console.error("[mikan] event_proposals insert failed, rolling back message:", propErr);
          const { error: rollbackErr } = await supabase
            .from("messages")
            .delete()
            .eq("id", msgData.id);
          if (rollbackErr) {
            console.error("[mikan] rollback delete also failed:", rollbackErr);
          }
          return new Response("event_proposals insert failed", { status: 500 });
        }

        return new Response("proposal posted", { status: 200 });
      }
    }

    // 通常テキスト返信
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
