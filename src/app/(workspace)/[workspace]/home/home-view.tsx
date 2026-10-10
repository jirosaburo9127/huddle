"use client";

import { UiIcon } from "@/components/ui-icon";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { extractDisplayFileName } from "@/lib/file-name";
import { TaskModal } from "../tasks/components/task-modal";
import { HuddleMark } from "@/components/huddle-mark";
import { isSystemPost, leadingSystemIcon, stripSystemEmoji } from "@/lib/system-post-icons";

export type HomePerson = { name: string; avatarUrl: string | null };

export type HomeReaction = { id: string; emoji: string; userId: string };

export type HomeMessage = {
  id: string;
  content: string;
  createdAt: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  isDm: boolean;
  parentId: string | null;
  sender: HomePerson;
  isMine: boolean;
  isDecision: boolean;
  replyCount: number;
  isMention: boolean;
  isUnread: boolean;
  reactions: HomeReaction[];
};

export type HomeTaskEvent = {
  id: string;
  title: string;
  doneAt: string;
  channelName: string;
  channelSlug: string;
  assignees: HomePerson[];
  creator: HomePerson;
};

export type HomeRailItem = {
  key: string;
  label: string;
  title: string;
  sub: string;
  person: HomePerson | null;
  href: string;
};

// あなた待ち: 自分が担当で、期限が今日まで（または過ぎた）のタスク
export type HomeWaitingTask = {
  id: string;
  title: string;
  isOverdue: boolean;
  channelName: string;
};

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  me: HomePerson;
  messages: HomeMessage[];
  taskEvents: HomeTaskEvent[];
  railItems: HomeRailItem[];
  waitingMessages: HomeMessage[];
  waitingTasks: HomeWaitingTask[];
};

type Filter = "all" | "mention" | "unread" | "decision";

type TimelineItem =
  | { kind: "message"; at: string; message: HomeMessage }
  | { kind: "task"; at: string; task: HomeTaskEvent };

const QUICK_REACTIONS = ["👍", "🙏", "🎉", "👀", "✅", "❤️"];
// あなた待ちに一度に並べる件数（多すぎると読む気が失せるので絞る）
const WAITING_LIMIT = 5;
// 「今日の動き」をタイムラインの何件目の後ろに差し込むか
const RAIL_POSITION = 2;
const AVATAR_COLORS = ["#3E8E7E", "#5B7FD1", "#D9825B", "#8A6BBE", "#C2607F", "#4E9BB5"];

function formatTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Avatar({ person, size }: { person: HomePerson; size: number }) {
  if (person.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  let hash = 0;
  for (const ch of person.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="rounded-full shrink-0 flex items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: AVATAR_COLORS[hash % AVATAR_COLORS.length],
      }}
      aria-hidden="true"
    >
      {person.name.charAt(0)}
    </span>
  );
}

// 本文を「文章」と「添付」に分ける（添付URLをそのまま出すと読めないため）
function splitContent(content: string): { text: string; files: string[] } {
  const files: string[] = [];
  const text = content
    .replace(/https?:\/\/\S+/g, (url) => {
      if (url.includes("/storage/v1/object/")) {
        files.push(url);
        return "";
      }
      return url;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, files };
}

function MessageBody({ text, myName }: { text: string; myName: string }) {
  // URL はリンクに、@メンションは色付きにする。表示名は空白を含むことがあるので、自分の名前は丸ごと拾う
  const escaped = myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mention = myName ? `@${escaped}|@[^\\s@]+` : "@[^\\s@]+";
  const pattern = new RegExp(`(https?:\\/\\/[^\\s<]+|${mention})`, "g");
  // 予定・アルバムの自動投稿は、行頭の目印（絵文字）を線画アイコンに差し替える
  const system = isSystemPost(text);
  function renderInline(source: string, keyPrefix: string) {
    return source.split(pattern).map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (/^https?:\/\//.test(part)) {
        return (
          <a
            key={key}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--home-accent-ink)] underline underline-offset-2 break-all"
          >
            {part}
          </a>
        );
      }
      if (part.startsWith("@")) {
        return (
          <span key={key} className="font-bold text-[var(--home-accent-ink)]">
            {part}
          </span>
        );
      }
      return part;
    });
  }
  return (
    <p className="mt-2.5 text-[15px] leading-7 text-foreground whitespace-pre-wrap break-words line-clamp-6">
      {system
        ? text.split("\n").map((line, i) => {
            const mark = leadingSystemIcon(line);
            return (
              <span key={i}>
                {i > 0 && "\n"}
                {mark && <UiIcon name={mark.icon} size={15} className="inline-block align-[-2px] mr-1 text-muted" />}
                {renderInline(mark ? mark.rest : line, `l${i}`)}
              </span>
            );
          })
        : renderInline(text, "t")}
    </p>
  );
}

const ICON = {
  reply: "M9 14L4 9l5-5M4 9h10a6 6 0 016 6v4",
  task: "M8.5 12.5l2.5 2.5 4.5-5",
  chevron: "M9 6l6 6-6 6",
};

export function HomeView({
  workspaceId,
  workspaceSlug,
  currentUserId,
  me,
  messages,
  taskEvents,
  railItems,
  waitingMessages,
  waitingTasks,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const setMessageInputFocused = useMobileNavStore((s) => s.setMessageInputFocused);

  const [filter, setFilter] = useState<Filter>("all");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [taskSource, setTaskSource] = useState<HomeMessage | null>(null);
  // リアクションだけは押した瞬間に反映したいので手元に持つ。
  // サーバーから取り直すたびに丸ごと置き換える（マージしない）。
  const [reactions, setReactions] = useState<Record<string, HomeReaction[]>>({});
  // 時刻依存の表示は SSR/CSR で食い違うので、マウント後に確定させる
  const [now, setNow] = useState<Date | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  // あなた待ちは、片付けた瞬間に行を消したいので手元で伏せる（サーバーから取り直せば元データからも消える）
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  // この画面を開いている間に1件でもあなた待ちがあったか（全部片付けたときのねぎらい表示用）
  const [hadWaiting, setHadWaiting] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setReactions(Object.fromEntries(messages.map((m) => [m.id, m.reactions])));
  }, [messages]);

  // 新着・リアクション・タスク更新が来たらサーバーから取り直す（連続しても1回にまとめる）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const realtime = supabase
      .channel(`home-feed-${workspaceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, refresh)
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(realtime);
    };
  }, [supabase, workspaceId, router]);

  useEffect(() => {
    if (replyingId) replyInputRef.current?.focus();
  }, [replyingId]);

  const openWaitingMessages = useMemo(
    () => waitingMessages.filter((m) => !cleared.has(m.id)),
    [waitingMessages, cleared]
  );
  const openWaitingTasks = useMemo(() => waitingTasks.filter((t) => !cleared.has(t.id)), [waitingTasks, cleared]);
  const waitingCount = openWaitingMessages.length + openWaitingTasks.length;

  useEffect(() => {
    if (waitingCount > 0) setHadWaiting(true);
  }, [waitingCount]);

  const mentionCount = useMemo(() => messages.filter((m) => m.isMention && m.isUnread).length, [messages]);
  const unreadCount = useMemo(() => messages.filter((m) => m.isUnread).length, [messages]);

  const timeline = useMemo<TimelineItem[]>(() => {
    // 「すべて」では、上の「あなた待ち」に出している投稿をタイムラインに重ねて出さない
    const waitingIds = new Set(openWaitingMessages.slice(0, WAITING_LIMIT).map((m) => m.id));
    const filtered = messages.filter((m) => {
      if (filter === "all") return !waitingIds.has(m.id);
      if (filter === "mention") return m.isMention;
      if (filter === "unread") return m.isUnread;
      if (filter === "decision") return m.isDecision;
      return true;
    });
    const items: TimelineItem[] = filtered.map((m) => ({ kind: "message", at: m.createdAt, message: m }));
    if (filter === "all") {
      for (const task of taskEvents) items.push({ kind: "task", at: task.doneAt, task });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [messages, taskEvents, filter, openWaitingMessages]);

  async function sendReply(message: HomeMessage) {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        channel_id: message.channelId,
        user_id: currentUserId,
        content: text,
        // スレッド内の投稿への返信は同じ親にぶら下げる
        parent_id: message.parentId ?? message.id,
      });
      if (error) {
        alert("送信に失敗しました: " + error.message);
        return;
      }
      // 返信した＝読んだ扱い。サイドバーのバッジも同じイベントで消す
      const { data: marked, error: markError } = await supabase.rpc("mark_channel_read", {
        p_channel_id: message.channelId,
      });
      if (markError) {
        console.error("[home] mark_channel_read failed:", markError);
      } else if (marked) {
        window.dispatchEvent(
          new CustomEvent("huddle:channelRead", {
            detail: { channelId: message.channelId, lastReadAt: marked as unknown as string },
          })
        );
      }
      setReplyText("");
      setReplyingId(null);
      setCleared((prev) => new Set(prev).add(message.id));
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setPickerId(null);
    const current = reactions[messageId] || [];
    const mine = current.find((r) => r.emoji === emoji && r.userId === currentUserId);
    if (mine) {
      setReactions((prev) => ({ ...prev, [messageId]: current.filter((r) => r.id !== mine.id) }));
      const { error } = await supabase.from("reactions").delete().eq("id", mine.id);
      if (error) {
        console.error("[home] reaction delete failed:", error);
        setReactions((prev) => ({ ...prev, [messageId]: current }));
      }
      return;
    }
    const added: HomeReaction = { id: crypto.randomUUID(), emoji, userId: currentUserId };
    setReactions((prev) => ({ ...prev, [messageId]: [...current, added] }));
    const { error } = await supabase
      .from("reactions")
      .insert({ id: added.id, message_id: messageId, user_id: currentUserId, emoji });
    if (error) {
      console.error("[home] reaction insert failed:", error);
      setReactions((prev) => ({ ...prev, [messageId]: current }));
    }
  }

  // あなた待ち: 👍 ひとつで「見ました」を返す
  async function ackWaiting(message: HomeMessage) {
    setCleared((prev) => new Set(prev).add(message.id));
    const { error } = await supabase
      .from("reactions")
      .insert({ message_id: message.id, user_id: currentUserId, emoji: "👍" });
    if (error) {
      console.error("[home] ack reaction failed:", error);
      setCleared((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
      alert("リアクションに失敗しました: " + error.message);
      return;
    }
    router.refresh();
  }

  // あなた待ち: タスクをその場で完了にする
  async function completeWaitingTask(task: HomeWaitingTask) {
    setCleared((prev) => new Set(prev).add(task.id));
    const { error } = await supabase
      .from("tasks")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) {
      console.error("[home] task complete failed:", error);
      setCleared((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      alert("完了にできませんでした: " + error.message);
      return;
    }
    router.refresh();
  }

  const chips: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: "すべて" },
    { key: "mention", label: "あなた宛て", count: mentionCount },
    { key: "unread", label: "未読", count: unreadCount },
    { key: "decision", label: "決定事項" },
  ];

  const cardClass = "animate-home-card-in bg-surface mt-2 lg:rounded-2xl lg:border lg:border-border";

  // side=true は PC の右カラム用（縦並び）。false はタイムライン内に差し込む横スクロール版
  function renderRail(side = false) {
    if (railItems.length === 0) return null;
    return (
      <section key="rail" className={`${cardClass} pt-3.5 pb-4 ${side ? "" : "xl:hidden"}`}>
        <h2 className="px-4 text-[15px] font-extrabold text-foreground">今日の動き</h2>
        <div className={`mt-2.5 flex gap-2.5 px-4 ${side ? "flex-col" : "overflow-x-auto"}`}>
          {railItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`rounded-2xl border border-border p-3 ${side ? "" : "shrink-0 w-[168px]"}`}
            >
              <p className="text-[11px] font-extrabold text-[var(--home-accent-ink)]">{item.label}</p>
              <p className={`mt-1 overflow-hidden text-[13px] font-bold leading-[1.45] text-foreground line-clamp-2 ${side ? "" : "h-[38px]"}`}>
                {item.title}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                {item.person && <Avatar person={item.person} size={20} />}
                <span className="truncate">{item.sub}</span>
              </p>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  // あなた待ち: 自分が動かないと止まるものだけ。その場で返せる
  function renderWaiting() {
    if (waitingCount === 0) {
      if (!hadWaiting) return null;
      return (
        <section className={`${cardClass} px-4 py-5 text-center`}>
          <p className="flex justify-center text-[var(--home-accent-ink)]">
            <UiIcon name="checkCircle" size={30} />
          </p>
          <p className="mt-1 text-sm font-extrabold text-foreground">全部返しました</p>
          <p className="mt-0.5 text-xs text-muted">あなた待ちの用件はありません</p>
        </section>
      );
    }
    const shownMessages = openWaitingMessages.slice(0, WAITING_LIMIT);
    const shownTasks = openWaitingTasks.slice(0, Math.max(0, WAITING_LIMIT - shownMessages.length));
    const rest = waitingCount - shownMessages.length - shownTasks.length;
    const btn = "inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold";
    return (
      <section className={`${cardClass} pt-3.5 pb-1`}>
        <h2 className="flex items-center gap-2 px-4 text-[15px] font-extrabold text-foreground">
          あなた待ち
          <span className="rounded-full bg-mention px-2 py-px text-[11px] font-extrabold text-white">{waitingCount}</span>
          <span className="text-[11.5px] font-normal text-muted">返すと消えます</span>
        </h2>
        <ul className="mt-1">
          {shownMessages.map((message) => {
            const { text, files } = splitContent(stripSystemEmoji(message.content));
            const replyKey = `waiting:${message.id}`;
            const isReplying = replyingId === replyKey;
            return (
              <li key={message.id} className="border-t border-border px-4 py-3 first:border-t-0">
                <div className="flex items-start gap-2.5">
                  <Avatar person={message.sender} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-muted">
                      <span className="font-bold text-foreground">{message.sender.name}</span>
                      {" ・ "}
                      {message.isDm ? "DM" : `# ${message.channelName}`}
                      {now ? ` ・ ${formatTime(message.createdAt, now)}` : ""}
                    </p>
                    <p className="mt-0.5 text-[14px] leading-6 text-foreground break-words line-clamp-2">
                      {text || (files.length > 0 ? "添付ファイル" : "")}
                    </p>
                  </div>
                </div>
                {isReplying ? (
                  <form
                    className="mt-2.5 flex items-center gap-2 rounded-[18px] border border-border bg-background pl-3.5 pr-1.5 py-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendReply(message);
                    }}
                  >
                    <input
                      ref={replyInputRef}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onFocus={() => setMessageInputFocused(true)}
                      onBlur={() => setMessageInputFocused(false)}
                      onKeyDown={(e) => {
                        // 日本語変換確定の Enter で送信しない
                        if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
                      }}
                      placeholder={`${message.sender.name}さんに返信`}
                      className="flex-1 min-w-0 bg-transparent text-[16px] lg:text-sm text-foreground outline-none placeholder:text-muted"
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim() || sending}
                      className="w-8 h-8 shrink-0 rounded-full bg-[var(--home-accent)] text-[var(--home-on-accent)] flex items-center justify-center disabled:opacity-40"
                      aria-label="送信"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </form>
                ) : (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[46px]">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyText("");
                        setReplyingId(replyKey);
                      }}
                      className={`${btn} bg-[var(--home-accent)] text-[var(--home-on-accent)]`}
                    >
                      返信する
                    </button>
                    <button
                      type="button"
                      onClick={() => void ackWaiting(message)}
                      className={`${btn} border border-border bg-surface text-foreground`}
                    >
                      👍 見ました
                    </button>
                    <Link
                      href={`/${workspaceSlug}/${message.channelSlug}?m=${message.id}`}
                      className={`${btn} text-muted`}
                    >
                      開く
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={ICON.chevron} />
                      </svg>
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
          {shownTasks.map((task) => (
            <li key={task.id} className="border-t border-border px-4 py-3 first:border-t-0">
              <div className="flex items-start gap-2.5">
                <span className="w-9 h-9 shrink-0 rounded-full bg-[var(--home-accent-soft)] text-[var(--home-accent-ink)] flex items-center justify-center">
                  <UiIcon name="checkSquare" size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-muted">
                    <span className={`font-bold ${task.isOverdue ? "text-mention" : "text-foreground"}`}>
                      {task.isOverdue ? "期限切れのタスク" : "今日が期限のタスク"}
                    </span>
                    {task.channelName ? ` ・ # ${task.channelName}` : ""}
                  </p>
                  <p className="mt-0.5 text-[14px] font-bold leading-6 text-foreground break-words line-clamp-2">{task.title}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[46px]">
                <button
                  type="button"
                  onClick={() => void completeWaitingTask(task)}
                  className={`${btn} bg-[var(--home-accent)] text-[var(--home-on-accent)]`}
                >
                  完了にする
                </button>
                <Link href={`/${workspaceSlug}/tasks`} className={`${btn} text-muted`}>
                  開く
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={ICON.chevron} />
                  </svg>
                </Link>
              </div>
            </li>
          ))}
        </ul>
        {rest > 0 && <p className="border-t border-border px-4 py-2.5 text-center text-xs text-muted">ほか {rest} 件</p>}
      </section>
    );
  }

  function renderTask(task: HomeTaskEvent) {
    const assignee = task.assignees[0] || task.creator;
    const showPair = task.assignees.length > 0 && task.creator.name !== assignee.name;
    return (
      <article key={`task-${task.id}`} className={`${cardClass} px-4 pt-3.5 pb-3.5`}>
        <div className="flex items-start gap-3">
          <Avatar person={assignee} size={46} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug text-muted">
              <span className="font-bold text-foreground">{assignee.name}</span> さんがタスクを完了しました！
            </p>
            <p className="mt-0.5 text-xs font-bold text-[var(--home-accent-ink)]"># {task.channelName}</p>
          </div>
          <span className="shrink-0 pt-0.5 text-[11.5px] text-muted">{now ? formatTime(task.doneAt, now) : ""}</span>
        </div>
        <div className="mt-3 flex items-center justify-center gap-4 rounded-2xl bg-[var(--home-accent-soft)] px-3 pt-4 pb-3.5">
          <div className="text-center">
            <div className="flex justify-center">
              <Avatar person={assignee} size={60} />
            </div>
            <p className="mt-1.5 text-[12.5px] font-bold text-foreground">{assignee.name}</p>
            <p className="text-[10.5px] text-muted">担当</p>
          </div>
          <span className="w-9 h-9 rounded-full bg-[var(--home-accent)] text-[var(--home-on-accent)] flex items-center justify-center">
            <UiIcon name="checkCircle" size={22} />
          </span>
          {showPair && (
            <div className="text-center">
              <div className="flex justify-center">
                <Avatar person={task.creator} size={60} />
              </div>
              <p className="mt-1.5 text-[12.5px] font-bold text-foreground">{task.creator.name}</p>
              <p className="text-[10.5px] text-muted">依頼</p>
            </div>
          )}
        </div>
        <p className="mt-3 text-[15px] font-bold text-foreground">{task.title}</p>
        <div className="mt-2.5 flex justify-end">
          <Link
            href={`/${workspaceSlug}/tasks`}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--home-accent)] px-4 py-1.5 text-[12.5px] font-bold text-[var(--home-on-accent)]"
          >
            見てみる
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICON.chevron} />
            </svg>
          </Link>
        </div>
      </article>
    );
  }

  function renderMessage(message: HomeMessage) {
    const { text, files } = splitContent(message.content);
    const list = reactions[message.id] || [];
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of list) {
      const g = grouped.get(r.emoji) || { count: 0, mine: false };
      grouped.set(r.emoji, { count: g.count + 1, mine: g.mine || r.userId === currentUserId });
    }
    const isReplying = replyingId === message.id;
    const channelHref = `/${workspaceSlug}/${message.channelSlug}`;
    // チャンネル内のこの投稿の位置へ直接飛ぶリンク
    const messageHref = `${channelHref}?m=${message.id}`;
    return (
      <article key={message.id} className={`${cardClass} px-4 pt-3.5`}>
        {(message.isMention || message.isDecision) && (
          <div className="mb-2 flex gap-1.5">
            {message.isMention && (
              <span className="rounded-full bg-mention px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                あなた宛て
              </span>
            )}
            {message.isDecision && (
              <span className="rounded-full bg-[var(--home-accent)] px-2.5 py-0.5 text-[10.5px] font-extrabold text-[var(--home-on-accent)]">
                決定事項
              </span>
            )}
          </div>
        )}
        <div className="flex items-start gap-3">
          <Avatar person={message.sender} size={46} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-snug text-foreground">
              {message.sender.name}
              {message.isMention && <span className="font-normal text-muted"> さんからあなたへ</span>}
            </p>
            <Link href={messageHref} className="mt-0.5 inline-block text-xs font-bold text-[var(--home-accent-ink)]">
              {message.isDm ? "ダイレクトメッセージ" : `# ${message.channelName}`}
            </Link>
          </div>
          <Link
            href={messageHref}
            className="shrink-0 flex items-center gap-1 pt-0.5 text-[11.5px] text-muted"
            aria-label="この投稿をチャンネルで開く"
          >
            {message.isUnread && <span className="w-2 h-2 rounded-full bg-[var(--home-accent)]" aria-hidden="true" />}
            {now ? formatTime(message.createdAt, now) : ""}
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICON.chevron} />
            </svg>
          </Link>
        </div>

        {text && <MessageBody text={text} myName={me.name} />}

        {files.map((url) => (
          <Link
            key={url}
            href={messageHref}
            className="mt-2.5 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <span className="w-9 h-9 shrink-0 rounded-[10px] bg-[var(--home-accent-soft)] text-[var(--home-accent-ink)] flex items-center justify-center">
              <UiIcon name="paperclip" size={18} />
            </span>
            <span className="min-w-0 truncate text-[13px] font-bold text-foreground">
              {extractDisplayFileName(url)}
            </span>
          </Link>
        ))}

        {grouped.size > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[...grouped.entries()].map(([emoji, g]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(message.id, emoji)}
                className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-bold ${
                  g.mine
                    ? "bg-[var(--home-accent-soft)] text-[var(--home-accent-ink)]"
                    : "bg-input-bg text-muted"
                }`}
              >
                {emoji} {g.count}
              </button>
            ))}
          </div>
        )}

        {pickerId === message.id && (
          <div className="mt-2.5 flex gap-1.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(message.id, emoji)}
                className="w-10 h-10 rounded-full bg-input-bg text-lg"
                aria-label={`${emoji} でリアクション`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {isReplying && (
          <form
            className="mt-2.5 flex items-center gap-2 rounded-[18px] border border-border bg-background pl-3.5 pr-1.5 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void sendReply(message);
            }}
          >
            <input
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onFocus={() => setMessageInputFocused(true)}
              onBlur={() => setMessageInputFocused(false)}
              onKeyDown={(e) => {
                // 日本語変換確定の Enter で送信しない
                if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
              }}
              placeholder={`${message.sender.name}さんに返信`}
              className="flex-1 min-w-0 bg-transparent text-[16px] lg:text-sm text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!replyText.trim() || sending}
              className="w-8 h-8 shrink-0 rounded-full bg-[var(--home-accent)] text-[var(--home-on-accent)] flex items-center justify-center disabled:opacity-40"
              aria-label="送信"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        )}

        <div className="mt-2.5 flex border-t border-border">
          <button
            type="button"
            onClick={() => {
              setReplyText("");
              setReplyingId(isReplying ? null : message.id);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold ${
              message.isMention ? "text-[var(--home-accent-ink)]" : "text-muted"
            }`}
          >
            <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={ICON.reply} />
            </svg>
            {message.replyCount > 0 ? `返信 ${message.replyCount}` : "返信する"}
          </button>
          <button
            type="button"
            onClick={() => setPickerId(pickerId === message.id ? null : message.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-muted"
          >
            <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 10h.01M15 10h.01" />
            </svg>
            リアクション
          </button>
          <button
            type="button"
            onClick={() => setTaskSource(message)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-muted"
          >
            <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <path strokeLinecap="round" strokeLinejoin="round" d={ICON.task} />
            </svg>
            タスクにする
          </button>
        </div>
      </article>
    );
  }

  const rail = filter === "all" ? renderRail() : null;

  return (
    <div className="home-tl flex flex-col h-full bg-[var(--home-band)]">
      {/* ヘッダー: スマホはロゴ＋検索の2段、PCはサイドバーにロゴ・検索があるので見出しとチップの1段 */}
      <header className="shrink-0 bg-surface border-b border-border lg:flex lg:h-14 lg:items-center lg:gap-5 lg:px-9">
        <div className="flex items-center justify-between px-4 py-2.5 lg:hidden">
          <button type="button" onClick={() => setSidebarOpen(true)} aria-label="チャンネル一覧を開く">
            <Avatar person={me} size={34} />
          </button>
          <p className="flex items-center gap-2 text-lg font-extrabold tracking-wide text-foreground">
            <HuddleMark size={18} />
            Huddle
          </p>
          <Link
            href={`/${workspaceSlug}/search`}
            className="w-[34px] h-[34px] flex items-center justify-center text-foreground"
            aria-label="検索"
          >
            <svg className="w-[21px] h-[21px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
        </div>
        <h1 className="hidden lg:block shrink-0 text-[18px] font-[720] text-foreground">ホーム</h1>
        {/* 絞り込み */}
        <div className="flex items-center gap-2.5 overflow-x-auto px-4 pb-3 pt-1 lg:p-0">
          <span className="shrink-0 text-sm font-extrabold text-foreground lg:hidden">いまの動き</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={`shrink-0 rounded-full border px-3.5 py-1 text-[12.5px] font-semibold transition-colors ${
                filter === chip.key
                  ? "border-[var(--home-accent)] bg-[var(--home-accent)] text-[var(--home-on-accent)]"
                  : "border-border bg-surface text-muted"
              }`}
            >
              {chip.label}
              {!!chip.count && (
                <span className={`ml-1 font-extrabold ${filter === chip.key ? "" : "text-mention"}`}>{chip.count}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="lg:flex lg:items-start lg:gap-6 lg:px-9 lg:pt-2">
        <div className="mx-auto w-full max-w-2xl pb-10 lg:mx-0 lg:max-w-[680px] lg:flex-1 lg:min-w-0">
          {filter === "all" && renderWaiting()}

          {timeline.length === 0 && (
            <div className={`${cardClass} px-4 py-12 text-center`}>
              <p className="mb-2 flex justify-center text-muted">
                <UiIcon name={filter === "all" ? "inbox" : "checkCircle"} size={30} />
              </p>
              <p className="text-sm font-bold text-foreground">
                {filter === "mention"
                  ? "あなた宛ての投稿はありません"
                  : filter === "unread"
                    ? "全部読みました"
                    : filter === "decision"
                      ? "最近の決定事項はありません"
                      : "まだ投稿がありません"}
              </p>
              <p className="mt-1 text-xs text-muted">新しい動きがあるとここに流れてきます</p>
            </div>
          )}

          {timeline.map((item, index) => (
            <div key={item.kind === "message" ? item.message.id : `task-${item.task.id}`}>
              {index === RAIL_POSITION && rail}
              {item.kind === "message" ? renderMessage(item.message) : renderTask(item.task)}
            </div>
          ))}
          {timeline.length > 0 && timeline.length <= RAIL_POSITION && rail}
          {timeline.length === 0 && rail}
        </div>
        {/* PC: 今日の動きは右カラムに固定表示 */}
        {filter === "all" && railItems.length > 0 && (
          <aside className="hidden xl:block sticky top-2 w-[300px] shrink-0">{renderRail(true)}</aside>
        )}
        </div>
      </div>

      {/* メッセージからのタスク化（チャンネル画面と同じモーダル） */}
      {taskSource && (
        <TaskModal
          task={null}
          channels={[]}
          currentUserId={currentUserId}
          fixedChannel={{ id: taskSource.channelId, name: taskSource.channelName, slug: taskSource.channelSlug }}
          initialTitle={taskSource.content.replace(/\s+/g, " ").trim().slice(0, 80)}
          messageId={taskSource.id}
          onClose={() => setTaskSource(null)}
          onSaved={() => {
            setTaskSource(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
