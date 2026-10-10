// Edge Function: みかんに整理してもらう
//
// チャンネルの最近の会話から「やること(タスク候補)」と「日時の決まった予定候補」を
// 拾って返す。登録はしない（画面でユーザーがチェックしたものだけクライアントが登録する）。
//
// 起点はユーザーがボタンを押したときだけ。投稿のたびに自動で動く見守りモードは
// 過去に廃止しており（mikan-respond 冒頭のコメント参照）、ここでも持ち込まない。
//
// 認証: 呼び出し元ユーザーの JWT を検証し、対象チャンネルのメンバーであることを確認する。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// 押したときだけ動く機能なので、読み落としの少なさを優先して Sonnet を使う
const MODEL = "claude-sonnet-5-5";
const MIKAN_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
// 会話として読む範囲。期間で区切り、その中の新しい側から上限件数まで
const LOOKBACK_DAYS = 14;
const MAX_MESSAGES = 120;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function nowJstString(): string {
  const d = new Date(Date.now() + JST_OFFSET_MS);
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.toISOString().slice(0, 10)} (${dow}) ${d.toISOString().slice(11, 16)}`;
}

const REPORT_TOOL = {
  name: "report_items",
  description: "会話から拾ったタスク候補と予定候補を報告する。該当が無ければ空配列で報告する。",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "何をするかが一目で分かる短いタイトル（30文字以内）" },
            assignee_names: {
              type: "array",
              items: { type: "string" },
              description: "担当者。メンバー一覧の表示名と完全に同じ文字列で。会話から分からなければ空配列",
            },
            due_date: {
              type: ["string", "null"],
              description: "期限 (YYYY-MM-DD)。会話に期限が無ければ null。推測で作らない",
            },
            source: { type: "integer", description: "根拠になった発言の番号" },
          },
          required: ["title", "assignee_names", "due_date", "source"],
        },
      },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "予定の名前（30文字以内）" },
            start_at: { type: "string", description: "開始日時 (日本時間, YYYY-MM-DDTHH:mm)" },
            location: { type: ["string", "null"], description: "場所。会話に無ければ null" },
            source: { type: "integer", description: "根拠になった発言の番号" },
          },
          required: ["title", "start_at", "location", "source"],
        },
      },
    },
    required: ["tasks", "events"],
  },
};

const SYSTEM_PROMPT = `あなたは業務チャット「Huddle」のアシスタント「みかん」です。
チャンネルの会話を読み、まだ登録されていない「タスク候補」と「予定候補」を拾って report_items で報告します。

タスク候補にするもの:
- 誰かへの依頼（「〜お願いできますか」「〜しておいてください」）→ 担当は頼まれた人
- 本人の宣言（「私がやります」「〜しておきます」「対応します」）→ 担当は発言した本人
- 会話で決まった「やること」
- 会話を最初から最後まで読み、該当するものは漏らさず全部拾う
- 質問・雑談・感想・すでに終わったと分かる用件は含めない

予定候補にするもの:
- 日付と時刻の両方が会話から特定できる集まり・打ち合わせ・イベント
- 日付だけ・時刻だけ・「来週あたり」のように曖昧なものは含めない（タスクにもしない）
- 現在日時より過去のものは含めない

共通ルール:
- 「明日」「金曜」などは、その発言の投稿日時を基準に日付へ直す。曜日は「カレンダー」の対応表で確かめる
- 「今週◯曜」は、カレンダーで発言日が載っている行（週）の◯曜。「来週◯曜」は、そのすぐ次の行の◯曜
  例: 発言日が 10(土) で、その行が「5(月)〜11(日)」なら、「来週火曜」は次の行の火曜＝13日（20日ではない）
- 「◯曜まで」「◯曜に」と週の指定が無いときは、発言日より後で最も近いその曜日
- 会話に書かれていないことを補わない。担当・期限・場所は分からなければ空/null
- 「登録済み」に挙げたタスク・予定と同じ用件は報告しない
- 同じ用件を重複して報告しない。後の発言で内容が変更・取り消しされていたら最新の内容に従う
- 該当が無ければ空配列で報告する。無理に拾わない

返答は必ず report_items の呼び出し1回だけで行う。文章での説明は書かない。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "no token" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      console.error("[mikan-organize] auth failed:", authErr?.message);
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const channelId = body.channel_id as string;
    if (!channelId) return json({ error: "channel_id required" }, 400);

    const { data: membership } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return json({ error: "not a member" }, 403);

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const [messagesRes, membersRes, tasksRes, eventsRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, content, created_at, user_id, profiles(display_name)")
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .is("system_event", null)
        .neq("user_id", MIKAN_USER_ID)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_MESSAGES),
      supabase
        .from("channel_members")
        .select("user_id, profiles(display_name)")
        .eq("channel_id", channelId),
      supabase.from("tasks").select("title").eq("channel_id", channelId).neq("status", "done"),
      supabase.from("events").select("title, start_at").eq("channel_id", channelId).gte("start_at", nowIso),
    ]);

    if (messagesRes.error) {
      console.error("[mikan-organize] messages fetch error:", messagesRes.error);
      return json({ error: "fetch failed" }, 500);
    }

    type Row = {
      id: string;
      content: string;
      created_at: string;
      user_id: string;
      profiles: { display_name: string } | { display_name: string }[] | null;
    };
    const nameOf = (p: Row["profiles"]) => (Array.isArray(p) ? p[0]?.display_name : p?.display_name) || "?";
    const rows = ((messagesRes.data || []) as Row[]).reverse();
    if (rows.length === 0) {
      return json({ tasks: [], events: [], scanned: 0 });
    }

    const members = ((membersRes.data || []) as Array<{ user_id: string; profiles: Row["profiles"] }>)
      .filter((m) => m.user_id !== MIKAN_USER_ID)
      .map((m) => ({ user_id: m.user_id, name: nameOf(m.profiles) }));

    // 曜日も添える（「金曜まで」「来週火曜」を日付に直すとき、モデルに曜日計算をさせない）
    const toJst = (iso: string) => {
      const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
      const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
      return `${d.toISOString().slice(0, 10)}(${dow}) ${d.toISOString().slice(11, 16)}`;
    };
    // 週ごと（月曜始まり）の日付表。「来週火曜」のような表現を、モデルに暦の計算をさせずに引かせる。
    // いちばん古い発言の週から、今日の3週先まで
    const DOW = ["日", "月", "火", "水", "木", "金", "土"];
    const dayMs = 24 * 60 * 60 * 1000;
    const first = new Date(new Date(rows[0].created_at).getTime() + JST_OFFSET_MS);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - mondayOffset * dayMs;
    const lastDay = Date.now() + JST_OFFSET_MS + 21 * dayMs;
    const calendarLines: string[] = [];
    while (cursor <= lastDay) {
      const days: string[] = [];
      for (let k = 0; k < 7; k++) {
        const d = new Date(cursor + k * dayMs);
        days.push(`${d.toISOString().slice(0, 10)}(${DOW[d.getUTCDay()]})`);
      }
      calendarLines.push(`週${calendarLines.length + 1}: ${days.join(" ")}`);
      cursor += 7 * dayMs;
    }
    const conversation = rows
      // 添付ファイルのURLは読んでも意味がないので落とす
      .map((m, i) => `[${i + 1}] ${toJst(m.created_at)} ${nameOf(m.profiles)}: ${m.content.replace(/https?:\/\/\S+\/storage\/v1\/object\/\S+/g, "(添付)")}`)
      .join("\n");

    const registered = [
      ...((tasksRes.data || []) as Array<{ title: string }>).map((t) => `タスク: ${t.title}`),
      ...((eventsRes.data || []) as Array<{ title: string; start_at: string }>).map((e) => `予定: ${e.title} (${toJst(e.start_at)})`),
    ];

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        tools: [REPORT_TOOL],
        // このモデルはツールの強制指定 (type: "tool") に対応していないため、指示で必ず呼ばせる
        tool_choice: { type: "auto" },
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: `現在日時 (JST): ${nowJstString()}` },
        ],
        messages: [
          {
            role: "user",
            content:
              `メンバー一覧: ${members.map((m) => m.name).join(" / ")}\n\n` +
              `カレンダー (1行が1週間・月曜始まり):\n${calendarLines.join("\n")}\n\n` +
              `登録済み:\n${registered.length > 0 ? registered.join("\n") : "(なし)"}\n\n` +
              `会話 (番号 日時 発言者: 本文):\n${conversation}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[mikan-organize] AI failed:", aiRes.status, errText);
      // 利用残高切れは、再試行しても直らないので画面で区別して伝える
      if (errText.includes("credit balance")) return json({ error: "ai_credit" }, 402);
      return json({ error: "AI failed" }, 502);
    }

    const aiJson = await aiRes.json() as {
      content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    };
    const input = aiJson.content.find((c) => c.type === "tool_use" && c.name === "report_items")?.input;
    if (!input) {
      console.error("[mikan-organize] no tool_use in response:", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "AI returned no result" }, 502);
    }

    const sourceOf = (n: unknown) => {
      const row = typeof n === "number" ? rows[n - 1] : undefined;
      return row
        ? { message_id: row.id, author: nameOf(row.profiles), excerpt: row.content.replace(/\s+/g, " ").trim().slice(0, 80) }
        : null;
    };

    const tasks = (Array.isArray(input.tasks) ? input.tasks : []).flatMap((t: Record<string, unknown>) => {
      const title = typeof t.title === "string" ? t.title.trim() : "";
      if (!title) return [];
      const names = Array.isArray(t.assignee_names) ? t.assignee_names.filter((n): n is string => typeof n === "string") : [];
      const assignees = names.flatMap((n) => {
        const hit = members.find((m) => m.name === n.trim());
        return hit ? [{ user_id: hit.user_id, name: hit.name }] : [];
      });
      const due = typeof t.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null;
      return [{ title, assignees, due_date: due, source: sourceOf(t.source) }];
    });

    const events = (Array.isArray(input.events) ? input.events : []).flatMap((e: Record<string, unknown>) => {
      const title = typeof e.title === "string" ? e.title.trim() : "";
      const startRaw = typeof e.start_at === "string" ? e.start_at : "";
      if (!title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startRaw)) return [];
      const start = new Date(`${startRaw.slice(0, 16)}:00+09:00`);
      if (Number.isNaN(start.getTime())) return [];
      const location = typeof e.location === "string" && e.location.trim() ? e.location.trim() : null;
      return [{ title, start_at: start.toISOString(), location, source: sourceOf(e.source) }];
    });

    return json({ tasks, events, scanned: rows.length });
  } catch (e) {
    console.error("[mikan-organize] unexpected:", e);
    return json({ error: "unexpected error" }, 500);
  }
});
