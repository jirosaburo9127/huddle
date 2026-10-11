"use client";

import { UiIcon } from "@/components/ui-icon";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { HuddleMark } from "@/components/huddle-mark";

type Source = { message_id: string; author: string; excerpt: string } | null;

type TaskCandidate = {
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  title: string;
  assignees: Array<{ user_id: string; name: string }>;
  due_date: string | null;
  source: Source;
};

type EventCandidate = {
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  title: string;
  start_at: string;
  location: string | null;
  source: Source;
};

type ExistingTask = { title: string; due_date: string | null; channel_name: string };
type ExistingEvent = { title: string; start_at: string; location: string | null; channel_name: string };

// 何を確認するか。ホームでは最初に選んでもらい、選んでから AI が会話を読む
type Mode = "my_tasks" | "week_events" | "all";

// いま開いている画面。メニューの並び（その画面で一番使いそうなものを先頭に）を決める
export type MikanContext = "home" | "channel" | "tasks" | "calendar" | "other";

// メニューで選んだ内容: どこを読むか（今のチャンネルだけ／参加チャンネル全部）と、何を拾うか
type Choice = { scope: "channel" | "workspace"; mode: Mode };

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  /** いま開いているチャンネル（通常チャンネルを開いているときだけ） */
  channel: { id: string; name: string } | null;
  context: MikanContext;
  currentUserId: string;
  /** 予定を登録したとき、その予定カード用メッセージの ID を知らせる */
  onEventCreated?: (messageId: string) => void;
  /** 1件でも登録したら呼ぶ（画面の取り直し用） */
  onRegistered?: () => void;
  onClose: () => void;
};

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/** 日時を日本語表記にする（予定カードの本文と同じ形式） */
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日(${DAY_NAMES[d.getDay()]}) ${h}:${m}`;
}

function formatDueJa(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日(${DAY_NAMES[d.getDay()]})まで`;
}

// まだ登録していない候補の控え（端末内）。みかんは前回読んだあとの新しい投稿だけを読むので、
// 前回見つけて登録しなかった候補はここから出し直す。元の投稿を見に行って戻ってきたときにも使う
type Pending = { at: number; tasks: TaskCandidate[]; events: EventCandidate[] };
const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function pendingKey(userId: string, scopeKey: string, mode: Mode): string {
  return `huddle:mikan-pending:${userId}:${scopeKey}:${mode}`;
}

function loadPending(key: string): Pending | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.events)) return null;
    if (Date.now() - parsed.at > PENDING_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    // 保存領域が使えない端末では控え無しで動かす
    return null;
  }
}

function savePending(key: string, tasks: TaskCandidate[], events: EventCandidate[]) {
  try {
    if (tasks.length + events.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), tasks, events } satisfies Pending));
  } catch {
    // 保存できなくても、今回の表示には影響しない
  }
}

/** 同じ候補かどうかの目印（根拠の投稿とタイトルが同じなら同じ候補） */
function candidateKey(c: { title: string; source: Source }): string {
  return `${c.source?.message_id ?? ""}|${c.title}`;
}

function mergeCandidates<T extends { title: string; source: Source }>(older: T[], newer: T[]): T[] {
  const seen = new Set(newer.map(candidateKey));
  return [...newer, ...older.filter((c) => !seen.has(candidateKey(c)))];
}

/** みかん: 何を確認するか選んでもらい、会話から拾ったタスク・予定の候補を選んで登録するモーダル */
export function MikanModal({ workspaceId, workspaceSlug, channel, context, currentUserId, onEventCreated, onRegistered, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  // 必ず選択画面から始め、選んでから AI が会話を読む
  const [choice, setChoice] = useState<Choice | null>(null);
  const mode = choice?.mode ?? null;
  // 参加チャンネル全部を読んでいるか（候補にチャンネル名を添えるかどうか等に使う）
  const isAll = choice?.scope !== "channel";
  const [phase, setPhase] = useState<"menu" | "loading" | "ready" | "saving" | "done" | "error">("menu");
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [existingEvents, setExistingEvents] = useState<ExistingEvent[]>([]);
  const [errorTitle, setErrorTitle] = useState("読み取れませんでした");
  const [errorMessage, setErrorMessage] = useState("");
  // 今日あと何回みかんに読んでもらえるか（分かるまで null）
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  // 前回読んだあとに新しい投稿が無く、AI を呼ばなかった
  const [noNew, setNoNew] = useState(false);
  // 一覧に、前回見つけて登録していなかった候補が混ざっている
  const [hasCarried, setHasCarried] = useState(false);
  // 最初から読み直すか（選び直すたびに決める）
  const [rescan, setRescan] = useState(false);
  const [tasks, setTasks] = useState<TaskCandidate[]>([]);
  const [events, setEvents] = useState<EventCandidate[]>([]);
  const [scanned, setScanned] = useState(0);
  const [channelCount, setChannelCount] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ tasks: number; events: number; failures: string[] }>({
    tasks: 0,
    events: 0,
    failures: [],
  });

  // 開いたときに、今日の残り回数だけ先に聞く（回数には数えない）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mikan-organize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "status" }),
        });
        if (!res.ok) {
          console.error("[mikan-organize] status request failed:", res.status, await res.text());
          return;
        }
        const json = (await res.json()) as { remaining: number; daily_limit: number };
        if (cancelled) return;
        setRemaining(json.remaining);
        setDailyLimit(json.daily_limit);
      } catch (e) {
        // 残り回数が出せないだけで、機能は使える
        console.error("[mikan-organize] status request error:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const scopeKey = choice ? (choice.scope === "channel" && channel ? `ch:${channel.id}` : `ws:${workspaceId}`) : "";

  useEffect(() => {
    if (!choice) return;
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("ログインし直してください");
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mikan-organize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...(choice.scope === "channel" && channel ? { channel_id: channel.id } : { workspace_id: workspaceId }),
            mode: choice.mode,
            rescan,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          console.error("[mikan-organize] request failed:", res.status, errText);
          if (res.status === 429 || res.status === 503) {
            // 上限に達した。回数は戻らないので、時間をおいての再試行は案内しない
            let limit: { remaining?: number; daily_limit?: number } = {};
            try {
              limit = JSON.parse(errText) as { remaining?: number; daily_limit?: number };
            } catch {
              limit = {};
            }
            if (cancelled) return;
            if (typeof limit.remaining === "number") setRemaining(limit.remaining);
            if (typeof limit.daily_limit === "number") setDailyLimit(limit.daily_limit);
            setErrorTitle(res.status === 429 ? "本日の上限に達しました" : "今月の上限に達しました");
            setErrorMessage(
              res.status === 429
                ? `みかんに会話を読んでもらえるのは1日${limit.daily_limit ?? 3}回までです。明日になるとまた使えます`
                : "ワークスペース全体での今月の利用回数が上限に達したため、みかんは来月まで会話を読めません"
            );
            setPhase("error");
            return;
          }
          if (res.status === 402) {
            throw new Error("AIの利用残高が不足しているため、みかんが動けません。ワークスペースの管理者に知らせてください");
          }
          throw new Error("みかんが会話を読み取れませんでした。時間をおいてもう一度お試しください");
        }
        const json = (await res.json()) as {
          tasks: TaskCandidate[];
          events: EventCandidate[];
          scanned: number;
          channels?: number;
          existing_tasks?: ExistingTask[];
          existing_events?: ExistingEvent[];
          no_new?: boolean;
          since_last?: boolean;
          remaining?: number;
          daily_limit?: number;
        };
        if (cancelled) return;
        // 前回の続きを読んだとき（新着なしも含む）は、前回登録しなかった候補を出し直す
        const key = pendingKey(currentUserId, scopeKey, choice.mode);
        const carried = json.no_new || json.since_last ? loadPending(key) : null;
        const nextTasks = mergeCandidates(carried?.tasks || [], json.tasks || []);
        const nextEvents = mergeCandidates(carried?.events || [], json.events || []);
        savePending(key, nextTasks, nextEvents);
        setNoNew(!!json.no_new);
        setHasCarried(!!carried && carried.tasks.length + carried.events.length > 0);
        if (typeof json.remaining === "number") setRemaining(json.remaining);
        if (typeof json.daily_limit === "number") setDailyLimit(json.daily_limit);
        json.tasks = nextTasks;
        json.events = nextEvents;
        setTasks(json.tasks || []);
        setEvents(json.events || []);
        setScanned(json.scanned || 0);
        setChannelCount(json.channels || 0);
        setExistingTasks(json.existing_tasks || []);
        setExistingEvents(json.existing_events || []);
        // 最初は全部にチェックを入れておき、要らないものだけ外してもらう
        setChecked(
          new Set([...(json.tasks || []).map((_, i) => `task-${i}`), ...(json.events || []).map((_, i) => `event-${i}`)])
        );
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorTitle("読み取れませんでした");
        setErrorMessage(e instanceof Error ? e.message : "エラーが発生しました");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // channel は親が毎回作り直すオブジェクトなので、ID だけを依存に入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, rescan, workspaceId, channel?.id, supabase]);

  function choose(next: Choice, fromStart = false) {
    setRescan(fromStart);
    setNoNew(false);
    setHasCarried(false);
    setTasks([]);
    setEvents([]);
    setExistingTasks([]);
    setExistingEvents([]);
    setChecked(new Set());
    setPhase("loading");
    // 同じ内容を選び直したときも読みに行くよう、毎回新しいオブジェクトにする
    setChoice({ ...next });
  }

  /** 候補の根拠になった投稿へ移動する（一覧は控えてあるので、開き直せば続きから見られる） */
  function openSource(candidate: { channel_slug: string; source: Source }) {
    if (!candidate.source || !candidate.channel_slug) return;
    router.push(`/${workspaceSlug}/${candidate.channel_slug}?m=${candidate.source.message_id}`);
    onClose();
  }

  function backToMenu() {
    setChoice(null);
    setPhase("menu");
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function register() {
    setPhase("saving");
    const failures: string[] = [];
    let taskCount = 0;
    let eventCount = 0;
    const registeredKeys = new Set<string>();

    for (const [i, task] of tasks.entries()) {
      if (!checked.has(`task-${i}`)) continue;
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          channel_id: task.channel_id,
          title: task.title,
          status: "todo",
          due_date: task.due_date,
          created_by: currentUserId,
          message_id: task.source?.message_id || null,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[mikan-organize] task insert failed:", error);
        failures.push(`タスク「${task.title}」: ${error?.message || "作成に失敗"}`);
        continue;
      }
      taskCount += 1;
      registeredKeys.add(`task|${candidateKey(task)}`);
      if (task.assignees.length > 0) {
        const { error: assignError } = await supabase
          .from("task_assignees")
          .insert(task.assignees.map((a) => ({ task_id: data.id, user_id: a.user_id })));
        if (assignError) {
          console.error("[mikan-organize] assignee insert failed:", assignError);
          failures.push(`タスク「${task.title}」の担当者: ${assignError.message}`);
        }
      }
    }

    for (const [i, event] of events.entries()) {
      if (!checked.has(`event-${i}`)) continue;
      // 予定は「予定カード用の投稿」とセットで登録する（予定作成モーダルと同じ手順）
      const locLine = event.location ? `\n📍 ${event.location}` : "";
      const { data: msg, error: msgError } = await supabase
        .from("messages")
        .insert({
          channel_id: event.channel_id,
          user_id: currentUserId,
          content: `📅 ${event.title}\n${formatDateTimeJa(event.start_at)}${locLine}`,
        })
        .select("id")
        .single();
      if (msgError || !msg) {
        console.error("[mikan-organize] event message insert failed:", msgError);
        failures.push(`予定「${event.title}」: ${msgError?.message || "作成に失敗"}`);
        continue;
      }
      const { error: rpcError } = await supabase.rpc("create_event", {
        p_message_id: msg.id,
        p_channel_id: event.channel_id,
        p_title: event.title,
        p_start_at: event.start_at,
        p_location: event.location,
        p_attendee_ids: [],
      });
      if (rpcError) {
        console.error("[mikan-organize] create_event failed:", rpcError);
        failures.push(`予定「${event.title}」: ${rpcError.message}`);
        // 予定になれなかった投稿を残さない
        await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", msg.id);
        continue;
      }
      eventCount += 1;
      registeredKeys.add(`event|${candidateKey(event)}`);
      onEventCreated?.(msg.id as string);
    }

    // 登録できたものを控えから外す（登録しなかった候補は次回も出す）
    if (choice) {
      savePending(
        pendingKey(currentUserId, scopeKey, choice.mode),
        tasks.filter((t) => !registeredKeys.has(`task|${candidateKey(t)}`)),
        events.filter((e) => !registeredKeys.has(`event|${candidateKey(e)}`))
      );
    }
    setResult({ tasks: taskCount, events: eventCount, failures });
    if (taskCount + eventCount > 0) onRegistered?.();
    setPhase("done");
  }

  const total = tasks.length + events.length;
  const existingTotal = existingTasks.length + existingEvents.length;
  const loadingLabel =
    mode === "my_tasks" ? "あなたのタスクを探しています" : mode === "week_events" ? "これから7日間の予定を探しています" : "やることと、日時の決まった予定を探しています";
  const subtitle = !choice
    ? "何を確認しますか？"
    : choice.scope === "channel"
      ? `# ${channel?.name ?? ""} の最近の会話から`
      : mode === "my_tasks"
        ? "あなたのタスク（登録済み＋会話から）"
        : mode === "week_events"
          ? "これから7日間の予定（登録済み＋会話から）"
          : "参加しているチャンネル全体の、この1週間の会話から";

  // メニュー。いまの画面で一番使いそうなものを先頭に置く
  type MenuItem = { key: string; choice: Choice; icon: "checkSquare" | "calendar" | "inbox"; title: string; desc: string };
  const myTasksItem: MenuItem = {
    key: "my_tasks",
    choice: { scope: "workspace", mode: "my_tasks" },
    icon: "checkSquare",
    title: "自分のタスクを確認する",
    desc: "登録済みのタスクと、会話の中であなたが頼まれたこと・やると言ったこと",
  };
  const weekEventsItem: MenuItem = {
    key: "week_events",
    choice: { scope: "workspace", mode: "week_events" },
    icon: "calendar",
    title: "今週の予定を確認する",
    desc: "これから7日間の登録済みの予定と、会話に出てきたまだ登録していない予定",
  };
  const channelItem: MenuItem | null = channel
    ? {
        key: "channel",
        choice: { scope: "channel", mode: "all" },
        icon: "inbox",
        title: "このチャンネルのやること・予定を拾う",
        desc: `# ${channel.name} の直近2週間の会話から、まだ登録していないものを探す`,
      }
    : null;
  const menuItems: MenuItem[] = (
    context === "channel"
      ? [channelItem, myTasksItem, weekEventsItem]
      : context === "calendar"
        ? [weekEventsItem, myTasksItem, channelItem]
        : [myTasksItem, weekEventsItem, channelItem]
  ).filter((item): item is MenuItem => !!item);

  const remainingLabel =
    remaining === null
      ? null
      : remaining > 0
        ? `今日はあと${remaining}回、みかんに会話を読んでもらえます${dailyLimit ? `（1日${dailyLimit}回まで）` : ""}`
        : "本日の上限に達しました。明日になるとまた会話を読んでもらえます";

  const checkbox = "mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent";
  const row = "flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer";

  // チャンネル画面はスライド用の transform の内側にあり、そのままだと下タブより奥に描かれて
  // 登録ボタンが隠れる。body 直下に出して下タブより手前にする
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full sm:max-w-md max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-surface border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold">
              <HuddleMark size={18} />
              みかんに整理してもらう
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground" aria-label="閉じる">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {phase === "menu" && (
            <div className="space-y-2.5">
              {menuItems.map((item, i) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => choose(item.choice)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left hover:bg-sidebar-hover transition-colors ${
                    i === 0 ? "border-[var(--home-accent)]" : "border-border"
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--home-accent-soft)] text-accent">
                    <UiIcon name={item.icon} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-foreground">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{item.desc}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => choose({ scope: "workspace", mode: "all" })}
                className="w-full px-4 py-2 text-center text-xs text-muted underline underline-offset-2"
              >
                チーム全体のやること・予定をまとめて拾う
              </button>
              <p className="pt-1 text-[11px] leading-relaxed text-muted">
                選ぶと、みかんが前回のあとの新しい投稿を読みます。数秒〜十数秒かかります。
              </p>
              {remainingLabel && (
                <p className={`text-[11px] font-bold leading-relaxed ${remaining === 0 ? "text-mention" : "text-muted"}`}>
                  {remainingLabel}
                </p>
              )}
            </div>
          )}

          {phase === "loading" && (
            <div className="py-10 text-center">
              <p className="flex justify-center animate-pulse">
                <HuddleMark size={36} />
              </p>
              <p className="mt-3 text-sm font-bold text-foreground">会話を読んでいます…</p>
              <p className="mt-1 text-xs text-muted">{loadingLabel}</p>
            </div>
          )}

          {phase === "error" && (
            <div className="py-10 text-center">
              <p className="text-sm font-bold text-foreground">{errorTitle}</p>
              <p className="mt-1 text-xs text-muted">{errorMessage}</p>
            </div>
          )}

          {(phase === "ready" || phase === "saving") && existingTotal > 0 && (
            <section className="mb-5">
              <h4 className="text-[13px] font-extrabold text-foreground">
                登録済み（{existingTotal}件）
              </h4>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {existingTasks.map((task, i) => (
                  <li key={`et-${i}`} className="px-3 py-2.5">
                    <p className="text-sm font-bold text-foreground break-words">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      # {task.channel_name} ・ 期限: {task.due_date ? formatDueJa(task.due_date) : "なし"}
                    </p>
                  </li>
                ))}
                {existingEvents.map((event, i) => (
                  <li key={`ee-${i}`} className="px-3 py-2.5">
                    <p className="text-sm font-bold text-foreground break-words">{event.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      # {event.channel_name} ・ {formatDateTimeJa(event.start_at)}
                      {event.location ? ` ・ ${event.location}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(phase === "ready" || phase === "saving") && total === 0 && (
            <div className="py-10 text-center">
              <p className="flex justify-center text-muted">
                <UiIcon name="checkCircle" size={30} />
              </p>
              <p className="mt-2 text-sm font-bold text-foreground">
                {noNew
                  ? "前回確認したあと、新しい投稿はありません"
                  : mode === "my_tasks"
                  ? "会話の中に、まだ登録していないあなたのタスクはありませんでした"
                  : mode === "week_events"
                    ? "会話の中に、まだ登録していない予定はありませんでした"
                    : "新しく登録するものは見つかりませんでした"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {noNew
                  ? "会話は読んでいないので、回数は減っていません"
                  : isAll
                    ? `${channelCount} チャンネル・${scanned} 件の投稿を確認しました`
                    : `${scanned} 件の投稿を確認しました`}
              </p>
            </div>
          )}

          {(phase === "ready" || phase === "saving") && total > 0 && (
            <>
              <h4 className="text-[13px] font-extrabold text-foreground">会話から見つけた、まだ登録していないもの（{total}件）</h4>
              <p className="mt-1 text-xs text-muted">
                {noNew
                  ? "前回のあと新しい投稿はありません。前回見つけて、まだ登録していない候補です。"
                  : `${isAll ? `${channelCount} チャンネル・` : ""}${scanned} 件の新しい投稿を読みました。${
                      hasCarried ? "前回見つけて登録していない候補も並べています。" : ""
                    }`}
                登録するものにチェックを入れてください。
              </p>

              {tasks.length > 0 && (
                <section className="mt-4">
                  <h4 className="text-xs font-bold text-muted">やること</h4>
                  <div className="mt-2 space-y-2">
                    {tasks.map((task, i) => (
                      <label key={`task-${i}`} className={row}>
                        <input
                          type="checkbox"
                          className={checkbox}
                          checked={checked.has(`task-${i}`)}
                          onChange={() => toggle(`task-${i}`)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-foreground break-words">{task.title}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {isAll && <span className="font-bold text-accent"># {task.channel_name} ・ </span>}
                            担当: {task.assignees.length > 0 ? task.assignees.map((a) => a.name).join("、") : "未定"}
                            {" ・ "}
                            期限: {task.due_date ? formatDueJa(task.due_date) : "なし"}
                          </span>
                          {task.source && (
                            <button
                              type="button"
                              onClick={(e) => {
                                // 行全体がチェックの切り替えなので、ここでは切り替えずに移動だけする
                                e.preventDefault();
                                e.stopPropagation();
                                openSource(task);
                              }}
                              className="mt-1 block w-full truncate text-left text-[11px] text-muted/80 underline underline-offset-2"
                              title="元の投稿を開く"
                            >
                              「{task.source.excerpt}」— {task.source.author}
                            </button>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {events.length > 0 && (
                <section className="mt-4">
                  <h4 className="text-xs font-bold text-muted">予定</h4>
                  <div className="mt-2 space-y-2">
                    {events.map((event, i) => (
                      <label key={`event-${i}`} className={row}>
                        <input
                          type="checkbox"
                          className={checkbox}
                          checked={checked.has(`event-${i}`)}
                          onChange={() => toggle(`event-${i}`)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-foreground break-words">{event.title}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {isAll && <span className="font-bold text-accent"># {event.channel_name} ・ </span>}
                            {formatDateTimeJa(event.start_at)}
                            {event.location ? ` ・ ${event.location}` : ""}
                          </span>
                          {event.source && (
                            <button
                              type="button"
                              onClick={(e) => {
                                // 行全体がチェックの切り替えなので、ここでは切り替えずに移動だけする
                                e.preventDefault();
                                e.stopPropagation();
                                openSource(event);
                              }}
                              className="mt-1 block w-full truncate text-left text-[11px] text-muted/80 underline underline-offset-2"
                              title="元の投稿を開く"
                            >
                              「{event.source.excerpt}」— {event.source.author}
                            </button>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <p className="mt-4 text-[11px] leading-relaxed text-muted">
                内容はAIが読み取ったものです。登録後にタスク・カレンダーの画面から直せます。予定を登録すると、{isAll ? "その" : "この"}チャンネルに予定のカードが投稿されます。
              </p>
            </>
          )}

          {phase === "done" && (
            <div className="py-8 text-center">
              <p className={`flex justify-center ${result.failures.length === 0 ? "text-accent" : "text-mention"}`}>
                <UiIcon name={result.failures.length === 0 ? "checkCircle" : "alert"} size={30} />
              </p>
              <p className="mt-2 text-sm font-bold text-foreground">
                タスク {result.tasks} 件・予定 {result.events} 件を登録しました
              </p>
              {result.failures.length > 0 && (
                <ul className="mt-3 space-y-1 text-left text-xs text-mention">
                  {result.failures.map((f) => (
                    <li key={f}>登録できませんでした — {f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {phase !== "menu" && phase !== "loading" && remainingLabel && (
          <p className={`px-5 pb-2 text-[11px] font-bold shrink-0 ${remaining === 0 ? "text-mention" : "text-muted"}`}>
            {remainingLabel}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-border/50 shrink-0">
          {(phase === "ready" || phase === "saving") && total > 0 ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted">
                キャンセル
              </button>
              <button
                onClick={() => void register()}
                disabled={checked.size === 0 || phase === "saving"}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-bold disabled:opacity-40"
              >
                {phase === "saving" ? "登録中…" : `選んだ ${checked.size} 件を登録`}
              </button>
            </>
          ) : (
            <>
              {(phase === "ready" || phase === "done") && choice && remaining !== 0 && (
                <button onClick={() => choose(choice, true)} className="px-4 py-2 text-sm text-muted">
                  最初から読み直す
                </button>
              )}
              {phase !== "menu" && phase !== "loading" && (
                <button onClick={backToMenu} className="px-4 py-2 text-sm text-muted">
                  ほかを確認する
                </button>
              )}
              <button onClick={onClose} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold">
                閉じる
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
