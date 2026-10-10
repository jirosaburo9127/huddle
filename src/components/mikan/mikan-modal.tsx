"use client";

import { UiIcon } from "@/components/ui-icon";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { HuddleMark } from "@/components/huddle-mark";

type Source = { message_id: string; author: string; excerpt: string } | null;

type TaskCandidate = {
  channel_id: string;
  channel_name: string;
  title: string;
  assignees: Array<{ user_id: string; name: string }>;
  due_date: string | null;
  source: Source;
};

type EventCandidate = {
  channel_id: string;
  channel_name: string;
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

/** みかん: 何を確認するか選んでもらい、会話から拾ったタスク・予定の候補を選んで登録するモーダル */
export function MikanModal({ workspaceId, channel, context, currentUserId, onEventCreated, onRegistered, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  // 必ず選択画面から始め、選んでから AI が会話を読む
  const [choice, setChoice] = useState<Choice | null>(null);
  const mode = choice?.mode ?? null;
  // 参加チャンネル全部を読んでいるか（候補にチャンネル名を添えるかどうか等に使う）
  const isAll = choice?.scope !== "channel";
  const [phase, setPhase] = useState<"menu" | "loading" | "ready" | "saving" | "done" | "error">("menu");
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [existingEvents, setExistingEvents] = useState<ExistingEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
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
          }),
        });
        if (!res.ok) {
          console.error("[mikan-organize] request failed:", res.status, await res.text());
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
        };
        if (cancelled) return;
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
        setErrorMessage(e instanceof Error ? e.message : "エラーが発生しました");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // channel は親が毎回作り直すオブジェクトなので、ID だけを依存に入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, workspaceId, channel?.id, supabase]);

  function choose(next: Choice) {
    setTasks([]);
    setEvents([]);
    setExistingTasks([]);
    setExistingEvents([]);
    setChecked(new Set());
    setPhase("loading");
    setChoice(next);
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
      onEventCreated?.(msg.id as string);
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
                選ぶと、みかんが会話を読みます。数秒〜十数秒かかります。
              </p>
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
              <p className="text-sm font-bold text-foreground">読み取れませんでした</p>
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
                {mode === "my_tasks"
                  ? "会話の中に、まだ登録していないあなたのタスクはありませんでした"
                  : mode === "week_events"
                    ? "会話の中に、まだ登録していない予定はありませんでした"
                    : "新しく登録するものは見つかりませんでした"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {isAll
                  ? `この1週間の ${channelCount} チャンネル・${scanned} 件の投稿を確認しました`
                  : `直近2週間の ${scanned} 件の投稿を確認しました`}
              </p>
            </div>
          )}

          {(phase === "ready" || phase === "saving") && total > 0 && (
            <>
              <h4 className="text-[13px] font-extrabold text-foreground">会話から見つけた、まだ登録していないもの（{total}件）</h4>
              <p className="mt-1 text-xs text-muted">
                {isAll ? `${channelCount} チャンネル・` : ""}
                {scanned} 件の投稿を読みました。登録するものにチェックを入れてください。
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
                            <span className="mt-1 block truncate text-[11px] text-muted/80">
                              「{task.source.excerpt}」— {task.source.author}
                            </span>
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
                            <span className="mt-1 block truncate text-[11px] text-muted/80">
                              「{event.source.excerpt}」— {event.source.author}
                            </span>
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

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border/50 shrink-0">
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
