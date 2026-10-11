// Edge Function: みかんに整理してもらう
//
// 最近の会話から「やること(タスク候補)」と「日時の決まった予定候補」を拾って返す。
// 登録はしない（画面でユーザーがチェックしたものだけクライアントが登録する）。
//
// 対象は2通り:
//   - channel_id 指定: そのチャンネルだけ（チャンネル画面の「整理」）
//   - workspace_id 指定: 自分が参加している通常チャンネル全部（ホームのみかんボタン）
//
// 何を拾うか (mode):
//   - "my_tasks":    押した本人がやるべきタスクだけ（頼まれた／自分でやると言った）
//   - "week_events": これから7日間に始まる予定だけ
//   - "all" (既定):  会話に出てくるタスク・予定すべて
// my_tasks / week_events では、すでに登録済みの「自分のタスク」「7日間の予定」も一緒に返す
// （AI は使わず DB から。確認の画面で並べて見せるため）。
//
// 起点はユーザーがボタンを押したときだけ。投稿のたびに自動で動く見守りモードは
// 過去に廃止しており（mikan-respond 冒頭のコメント参照）、ここでも持ち込まない。
//
// 回数上限: AI を呼ぶ直前に1回と数える（1人1日 DAILY_LIMIT 回、全体で月 MONTHLY_LIMIT 回）。
//   超えていたら 429（本人の1日分）/ 503（全体の月間分）を返す。AI が失敗したら数えた分は戻す。
//   応答には今日の残り回数 (remaining) を必ず入れる。
// 新着だけ読む: 前回 AI に読ませた時刻を「人 × 範囲 × mode」ごとに覚え、それより後の投稿だけを渡す。
//   新着が無ければ AI を呼ばず、回数も減らさない (no_new: true)。rescan: true で最初から読み直す。
//
// 認証: 呼び出し元ユーザーの JWT を検証し、本人が参加しているチャンネルだけを読む。

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
// ワークスペース全体のときは範囲を1週間に絞り、そのぶん件数の上限を広げる
const WS_LOOKBACK_DAYS = 7;
const WS_MAX_MESSAGES = 300;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// AI の利用料を固定するための上限。1人1日の回数（日本時間で切り替え）と、全員合計の月間回数
const DAILY_LIMIT = 3;
const MONTHLY_LIMIT = 30000;
// 1回に AI へ渡す会話の量（本文の文字数の合計）。超えたら古い側から落とす
const MAX_CONVERSATION_CHARS = 30000;
// 1件の投稿が長すぎるとき、AI に渡すのはここまで
const MAX_MESSAGE_CHARS = 1500;

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
- 複数チャンネルの会話が並ぶ場合、発言の頭の #チャンネル名 が同じもの同士が1つの会話。別のチャンネルの話を混ぜない
- 担当者は、その発言があったチャンネルのメンバーからだけ選ぶ
- 同じ用件を重複して報告しない。後の発言で内容が変更・取り消しされていたら最新の内容に従う
- 該当が無ければ空配列で報告する。無理に拾わない

返答は必ず report_items の呼び出し1回だけで行う。文章での説明は書かない。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // 回数を数えたあとに想定外の失敗が起きたとき、数えた分を戻すための控え
  let refundOnError: (() => Promise<void>) | null = null;
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "no token" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const body = await req.json();
    // 調査用: service role キーで呼んだときだけ、対象ユーザーを指定でき、AI応答の概要(diag)を返す。
    // service role はもともと全データを読めるので、権限は広がらない
    // 署名は関数の手前（verify_jwt）で検証済みなので、ここでは role の確認だけ行う
    let isService = false;
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      isService = payload.role === "service_role";
    } catch {
      isService = false;
    }
    let user: { id: string } | null = null;
    if (isService && typeof body.as_user_id === "string") {
      user = { id: body.as_user_id };
    } else {
      const { data, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !data.user) {
        console.error("[mikan-organize] auth failed:", authErr?.message);
        return json({ error: "unauthorized" }, 401);
      }
      user = data.user;
    }

    // 今日の残り回数。調査用の呼び出し (service role) は回数に数えない
    const quota = async (consume: boolean): Promise<{ ok: boolean; reason: "daily" | "monthly" | null; remaining: number }> => {
      if (isService) return { ok: true, reason: null, remaining: DAILY_LIMIT };
      const { data, error } = await supabase.rpc("mikan_quota", {
        p_user_id: user!.id,
        p_daily_limit: DAILY_LIMIT,
        p_monthly_limit: MONTHLY_LIMIT,
        p_consume: consume,
      });
      if (error || !data) {
        console.error("[mikan-organize] quota check failed:", error);
        throw new Error("quota check failed");
      }
      return data as { ok: boolean; reason: "daily" | "monthly" | null; remaining: number };
    };
    const refund = async () => {
      if (isService) return;
      const { error } = await supabase.rpc("mikan_quota_refund", { p_user_id: user!.id });
      if (error) console.error("[mikan-organize] quota refund failed:", error);
    };

    // メニューを開いたときの残り回数の問い合わせ（数えない）
    if (body.action === "status") {
      const status = await quota(false);
      return json({ remaining: status.remaining, daily_limit: DAILY_LIMIT, limit_reason: status.ok ? null : status.reason });
    }

    const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
    const rescan = body.rescan === true;
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
    const mode: "my_tasks" | "week_events" | "all" =
      body.mode === "my_tasks" || body.mode === "week_events" ? body.mode : "all";
    if (!channelId && !workspaceId) return json({ error: "channel_id or workspace_id required" }, 400);

    // 読んでよいチャンネル = 本人が参加しているもの。全体のときは DM・独り言・アーカイブ済みを除く
    type ChannelRow = { id: string; name: string; slug: string; is_dm: boolean; is_hitorigoto: boolean; is_archived: boolean; workspace_id: string };
    let membershipQuery = supabase
      .from("channel_members")
      .select("channel_id, channels!inner(id, name, slug, is_dm, is_hitorigoto, is_archived, workspace_id)")
      .eq("user_id", user.id);
    membershipQuery = channelId
      ? membershipQuery.eq("channel_id", channelId)
      : membershipQuery.eq("channels.workspace_id", workspaceId);
    const { data: membershipRows, error: membershipErr } = await membershipQuery;
    if (membershipErr) {
      console.error("[mikan-organize] membership fetch error:", membershipErr);
      return json({ error: "fetch failed" }, 500);
    }
    const channels = ((membershipRows || []) as unknown as Array<{ channels: ChannelRow | ChannelRow[] }>)
      .map((m) => (Array.isArray(m.channels) ? m.channels[0] : m.channels))
      .filter((c): c is ChannelRow => !!c && (!!channelId || (!c.is_dm && !c.is_hitorigoto && !c.is_archived)));
    if (channelId && channels.length === 0) return json({ error: "not a member" }, 403);
    if (channels.length === 0) {
      const status = await quota(false);
      return json({ tasks: [], events: [], existing_tasks: [], existing_events: [], scanned: 0, channels: 0, remaining: status.remaining, daily_limit: DAILY_LIMIT });
    }

    const channelIds = channels.map((c) => c.id);
    const channelNames = new Map(channels.map((c) => [c.id, c.name]));
    const channelSlugs = new Map(channels.map((c) => [c.id, c.slug]));
    const multi = !channelId;

    const lookbackDays = multi ? WS_LOOKBACK_DAYS : LOOKBACK_DAYS;
    const lookbackSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    // 前回 AI に読ませた時刻。あれば、それより後の投稿だけを読む（読み直しの指定と調査用の呼び出しは除く）
    const scanScope = channelId ? `ch:${channelId}` : `ws:${workspaceId}`;
    let lastScannedAt: string | null = null;
    if (!rescan && !isService) {
      const { data: scanRow, error: scanErr } = await supabase
        .from("mikan_scan_state")
        .select("last_scanned_at")
        .eq("user_id", user.id)
        .eq("scope", scanScope)
        .eq("mode", mode)
        .maybeSingle();
      if (scanErr) console.error("[mikan-organize] scan state fetch error:", scanErr);
      lastScannedAt = (scanRow as { last_scanned_at?: string } | null)?.last_scanned_at ?? null;
    }
    const sinceLast = !!lastScannedAt && lastScannedAt > lookbackSince;
    const since = sinceLast ? lastScannedAt! : lookbackSince;

    const weekEndIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const [messagesRes, membersRes, tasksRes, eventsRes, meRes, myTasksRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, content, created_at, user_id, channel_id, profiles(display_name)")
        .in("channel_id", channelIds)
        .is("deleted_at", null)
        .is("system_event", null)
        .neq("user_id", MIKAN_USER_ID)
        // 前回の続きのときは、前回読んだ時刻ちょうどの投稿を読み直さない
        [sinceLast ? "gt" : "gte"]("created_at", since)
        .order("created_at", { ascending: false })
        .limit(multi ? WS_MAX_MESSAGES : MAX_MESSAGES),
      supabase
        .from("channel_members")
        .select("channel_id, user_id, profiles(display_name)")
        .in("channel_id", channelIds),
      supabase.from("tasks").select("title, channel_id").in("channel_id", channelIds).neq("status", "done"),
      supabase
        .from("events")
        .select("title, start_at, location, channel_id")
        .in("channel_id", channelIds)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true }),
      supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      mode === "my_tasks"
        ? supabase
            .from("tasks")
            .select("title, due_date, channel_id, task_assignees!inner(user_id)")
            .in("channel_id", channelIds)
            .neq("status", "done")
            .eq("task_assignees.user_id", user.id)
            .order("due_date", { ascending: true, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const myName = (meRes.data as { display_name?: string } | null)?.display_name || "";

    // 登録済みのもの（確認画面でそのまま見せる）
    const existingTasks =
      mode === "my_tasks"
        ? ((myTasksRes.data || []) as Array<{ title: string; due_date: string | null; channel_id: string }>).map((t) => ({
            title: t.title,
            due_date: t.due_date,
            channel_name: channelNames.get(t.channel_id) || "",
          }))
        : [];
    const existingEvents =
      mode === "week_events"
        ? ((eventsRes.data || []) as Array<{ title: string; start_at: string; location: string | null; channel_id: string }>)
            .filter((e) => e.start_at < weekEndIso)
            .map((e) => ({
              title: e.title,
              start_at: e.start_at,
              location: e.location,
              channel_name: channelNames.get(e.channel_id) || "",
            }))
        : [];

    if (messagesRes.error) {
      console.error("[mikan-organize] messages fetch error:", messagesRes.error);
      return json({ error: "fetch failed" }, 500);
    }

    type Row = {
      id: string;
      content: string;
      created_at: string;
      user_id: string;
      channel_id: string;
      profiles: { display_name: string } | { display_name: string }[] | null;
    };
    const nameOf = (p: Row["profiles"]) => (Array.isArray(p) ? p[0]?.display_name : p?.display_name) || "?";
    // 渡す量の上限。新しい側から本文の文字数を足していき、上限を超えたところより古い投稿は落とす
    const kept: Row[] = [];
    let totalChars = 0;
    for (const m of (messagesRes.data || []) as Row[]) {
      const length = Math.min(m.content.length, MAX_MESSAGE_CHARS);
      if (kept.length > 0 && totalChars + length > MAX_CONVERSATION_CHARS) break;
      totalChars += length;
      kept.push(m);
    }
    // 古い順。全体のときはチャンネルごとにまとめて、会話の流れを追いやすくする
    const rows = kept.reverse();
    if (multi) {
      const order = new Map(channelIds.map((id, i) => [id, i]));
      rows.sort((a, b) =>
        a.channel_id === b.channel_id
          ? a.created_at.localeCompare(b.created_at)
          : (order.get(a.channel_id) ?? 0) - (order.get(b.channel_id) ?? 0)
      );
    }
    if (rows.length === 0) {
      // 読む投稿が無いので AI は呼ばない。回数も減らさない
      const status = await quota(false);
      return json({
        tasks: [],
        events: [],
        existing_tasks: existingTasks,
        existing_events: existingEvents,
        scanned: 0,
        channels: 0,
        no_new: sinceLast,
        remaining: status.remaining,
        daily_limit: DAILY_LIMIT,
      });
    }

    // 担当者は「その発言があったチャンネルのメンバー」からだけ選ぶ
    const membersByChannel = new Map<string, Array<{ user_id: string; name: string }>>();
    for (const m of (membersRes.data || []) as Array<{ channel_id: string; user_id: string; profiles: Row["profiles"] }>) {
      if (m.user_id === MIKAN_USER_ID) continue;
      const list = membersByChannel.get(m.channel_id) || [];
      list.push({ user_id: m.user_id, name: nameOf(m.profiles) });
      membersByChannel.set(m.channel_id, list);
    }
    // 会話に出てくるチャンネルだけを対象にする
    const activeChannelIds = channelIds.filter((id) => rows.some((r) => r.channel_id === id));

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
      .map((m, i) => `[${i + 1}] ${multi ? `#${channelNames.get(m.channel_id)} ` : ""}${toJst(m.created_at)} ${nameOf(m.profiles)}: ${m.content.slice(0, MAX_MESSAGE_CHARS).replace(/https?:\/\/\S+\/storage\/v1\/object\/\S+/g, "(添付)")}`)
      .join("\n");

    const registered = [
      ...((tasksRes.data || []) as Array<{ title: string; channel_id: string }>).map(
        (t) => `タスク: ${t.title}${multi ? ` (#${channelNames.get(t.channel_id)})` : ""}`
      ),
      ...((eventsRes.data || []) as Array<{ title: string; start_at: string; channel_id: string }>).map(
        (e) => `予定: ${e.title} (${toJst(e.start_at)})${multi ? ` (#${channelNames.get(e.channel_id)})` : ""}`
      ),
    ];
    const memberLines = activeChannelIds
      .map((id) => `${multi ? `#${channelNames.get(id)}: ` : ""}${(membersByChannel.get(id) || []).map((m) => m.name).join(" / ")}`)
      .join("\n");

    // 何を拾うかの絞り込み。会話の後ろに置いて、最後に読ませる
    const modeNote =
      mode === "my_tasks"
        ? `\n\n今回の依頼: 「${myName}」さん本人がやるべきタスクだけを報告する。` +
          `対象は、${myName}さんが名指しで頼まれたものと、${myName}さん自身が「やります」と言ったものだけ。` +
          `他の人が担当のもの、誰の担当か会話から読み取れないものは報告しない。` +
          `assignee_names には必ず「${myName}」を入れる。予定は報告しない（events は空配列）。`
        : mode === "week_events"
          ? `\n\n今回の依頼: 開始日時が今から7日以内（${toJst(nowIso)} 〜 ${toJst(weekEndIso)}）の予定候補だけを報告する。` +
            `タスクは報告しない（tasks は空配列）。`
          : "";

    // ここから AI を呼ぶので、1回と数える。上限を超えていたら呼ばずに返す
    const consumed = await quota(true);
    if (!consumed.ok) {
      return json(
        { error: consumed.reason === "monthly" ? "monthly_limit" : "daily_limit", remaining: consumed.remaining, daily_limit: DAILY_LIMIT },
        consumed.reason === "monthly" ? 503 : 429
      );
    }
    const remaining = consumed.remaining;
    refundOnError = refund;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // このモデルは既定で「考える」段階を持ち、その分も max_tokens から引かれる。
        // 会話量が多いと考えるだけで上限を使い切り、答え（ツール呼び出し）に届かず失敗していたため、
        // 考える段階を切り、上限にも余裕を持たせる
        max_tokens: 8000,
        thinking: { type: "between_tools" },
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
              `メンバー一覧${multi ? " (チャンネルごと)" : ""}:\n${memberLines}\n\n` +
              `カレンダー (1行が1週間・月曜始まり):\n${calendarLines.join("\n")}\n\n` +
              `登録済み:\n${registered.length > 0 ? registered.join("\n") : "(なし)"}\n\n` +
              `会話 (番号 ${multi ? "#チャンネル " : ""}日時 発言者: 本文):\n${conversation}` +
              modeNote,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[mikan-organize] AI failed:", aiRes.status, errText);
      // 結果を返せなかった分は数えない
      refundOnError = null;
      await refund();
      // 利用残高切れは、再試行しても直らないので画面で区別して伝える
      if (errText.includes("credit balance")) return json({ error: "ai_credit" }, 402);
      return json({ error: "AI failed", diag: isService ? { status: aiRes.status, body: errText.slice(0, 400) } : undefined }, 502);
    }

    const aiJson = await aiRes.json() as {
      content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const diag = isService
      ? { stop_reason: aiJson.stop_reason, blocks: aiJson.content.map((c) => c.type), usage: aiJson.usage }
      : undefined;
    const input = aiJson.content.find((c) => c.type === "tool_use" && c.name === "report_items")?.input;
    if (!input) {
      console.error("[mikan-organize] no tool_use in response:", JSON.stringify(aiJson).slice(0, 500));
      refundOnError = null;
      await refund();
      return json({ error: "AI returned no result", diag }, 502);
    }

    // 候補がどのチャンネルのものかは、根拠の発言から決める（モデルには答えさせない）
    const resolve = (n: unknown) => {
      const row = typeof n === "number" ? rows[n - 1] : undefined;
      const targetChannelId = row?.channel_id || channelId;
      if (!targetChannelId) return null;
      return {
        channel_id: targetChannelId,
        channel_name: channelNames.get(targetChannelId) || "",
        channel_slug: channelSlugs.get(targetChannelId) || "",
        source: row
          ? { message_id: row.id, author: nameOf(row.profiles), excerpt: row.content.replace(/\s+/g, " ").trim().slice(0, 80) }
          : null,
      };
    };

    const tasks = (Array.isArray(input.tasks) ? input.tasks : []).flatMap((t: Record<string, unknown>) => {
      const title = typeof t.title === "string" ? t.title.trim() : "";
      const target = resolve(t.source);
      if (!title || !target) return [];
      const members = membersByChannel.get(target.channel_id) || [];
      const names = Array.isArray(t.assignee_names) ? t.assignee_names.filter((n): n is string => typeof n === "string") : [];
      const assignees = names.flatMap((n) => {
        const hit = members.find((m) => m.name === n.trim());
        return hit ? [{ user_id: hit.user_id, name: hit.name }] : [];
      });
      const due = typeof t.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null;
      return [{ title, assignees, due_date: due, ...target }];
    });

    const events = (Array.isArray(input.events) ? input.events : []).flatMap((e: Record<string, unknown>) => {
      const title = typeof e.title === "string" ? e.title.trim() : "";
      const startRaw = typeof e.start_at === "string" ? e.start_at : "";
      const target = resolve(e.source);
      if (!title || !target || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startRaw)) return [];
      const start = new Date(`${startRaw.slice(0, 16)}:00+09:00`);
      if (Number.isNaN(start.getTime())) return [];
      const location = typeof e.location === "string" && e.location.trim() ? e.location.trim() : null;
      return [{ title, start_at: start.toISOString(), location, ...target }];
    });

    // 絞り込みは AI 任せにせず、ここでも機械的にかける
    const finalTasks =
      mode === "week_events"
        ? []
        : mode === "my_tasks"
          ? tasks.filter((t) => t.assignees.some((a) => a.user_id === user.id))
          : tasks;
    const finalEvents =
      mode === "my_tasks"
        ? []
        : mode === "week_events"
          ? events.filter((e) => e.start_at >= nowIso && e.start_at < weekEndIso)
          : events;

    // 次回はここより後の投稿だけを読む（取得を始めた時刻を記録するので、処理中に来た投稿は次回に回る）
    if (!isService) {
      const { error: scanSaveErr } = await supabase
        .from("mikan_scan_state")
        .upsert({ user_id: user.id, scope: scanScope, mode, last_scanned_at: nowIso }, { onConflict: "user_id,scope,mode" });
      if (scanSaveErr) console.error("[mikan-organize] scan state save error:", scanSaveErr);
    }

    refundOnError = null;
    return json({
      tasks: finalTasks,
      events: finalEvents,
      existing_tasks: existingTasks,
      existing_events: existingEvents,
      scanned: rows.length,
      channels: activeChannelIds.length,
      since_last: sinceLast,
      remaining,
      daily_limit: DAILY_LIMIT,
      diag,
    });
  } catch (e) {
    console.error("[mikan-organize] unexpected:", e);
    if (refundOnError) await refundOnError();
    return json({ error: "unexpected error" }, 500);
  }
});
