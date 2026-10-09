"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";

export type HomeMessage = {
  id: string;
  content: string;
  createdAt: string;
  senderName: string;
  isMention: boolean;
};

export type HomeChannel = {
  id: string;
  name: string;
  slug: string;
  isDm: boolean;
  iconUrl: string | null;
  unreadCount: number;
  hasMention: boolean;
  latestAt: string | null;
  // 未読メッセージ（新しい順）
  messages: HomeMessage[];
};

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  displayName: string;
  channels: HomeChannel[];
};

type Filter = "all" | "mention" | "unread";

// カードに最初から見せる件数
const PREVIEW_COUNT = 3;

function greeting(hour: number): string {
  if (hour < 5) return "おつかれさまです";
  if (hour < 11) return "おはようございます";
  if (hour < 18) return "こんにちは";
  return "おつかれさまです";
}

function formatDate(d: Date): string {
  const week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${week}曜`;
}

function formatTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 本文を1行プレビュー用に整える（添付URLはそのまま出すと読めないので置き換える）
function toPreview(content: string): string {
  const text = content
    .replace(/https?:\/\/\S+/g, "📎 添付")
    .replace(/\s+/g, " ")
    .trim();
  return text || "（本文なし）";
}

// メンション付きを先頭に、残りを新しい順で埋める
function pickPreview(messages: HomeMessage[]): HomeMessage[] {
  const mentions = messages.filter((m) => m.isMention);
  const others = messages.filter((m) => !m.isMention);
  return [...mentions, ...others].slice(0, PREVIEW_COUNT);
}

export function HomeView({ workspaceId, workspaceSlug, currentUserId, displayName, channels }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const setMessageInputFocused = useMobileNavStore((s) => s.setMessageInputFocused);

  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  // 時刻依存の表示は SSR/CSR で食い違うので、マウント後に確定させる
  const [now, setNow] = useState<Date | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // 新着が来たらサーバーから取り直す（連投でも1回にまとめる）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const realtime = supabase
      .channel(`home-feed-${workspaceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
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

  const unreadChannels = useMemo(
    () =>
      channels
        .filter((c) => c.unreadCount > 0)
        .sort((a, b) => {
          if (a.hasMention !== b.hasMention) return a.hasMention ? -1 : 1;
          return (b.latestAt || "").localeCompare(a.latestAt || "");
        }),
    [channels]
  );
  const mentionChannels = useMemo(() => unreadChannels.filter((c) => c.hasMention), [unreadChannels]);
  const quietChannels = useMemo(
    () => channels.filter((c) => c.unreadCount === 0 && !c.isDm),
    [channels]
  );

  const visible = filter === "mention" ? mentionChannels : unreadChannels;

  function openReply(channelId: string) {
    setReplyText("");
    setReplyingId((prev) => (prev === channelId ? null : channelId));
  }

  async function sendReply(channel: HomeChannel) {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        channel_id: channel.id,
        user_id: currentUserId,
        content: text,
      });
      if (error) {
        alert("送信に失敗しました: " + error.message);
        return;
      }
      // 返信した＝読んだ扱い。サイドバーのバッジも同じイベントで消す
      const { data: marked, error: markError } = await supabase.rpc("mark_channel_read", {
        p_channel_id: channel.id,
      });
      if (markError) {
        console.error("[home] mark_channel_read failed:", markError);
      } else if (marked) {
        window.dispatchEvent(
          new CustomEvent("huddle:channelRead", {
            detail: { channelId: channel.id, lastReadAt: marked as unknown as string },
          })
        );
      }
      setReplyText("");
      setReplyingId(null);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  const chips: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: "すべて" },
    { key: "mention", label: "@自分宛て", count: mentionChannels.length },
    { key: "unread", label: "未読", count: unreadChannels.length },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 lg:px-6 pt-4 pb-8">
          {/* 挨拶 */}
          <header className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {now ? greeting(now.getHours()) : "こんにちは"}
                {displayName ? `、${displayName}さん` : ""}
              </h1>
              <p className="text-xs text-muted mt-0.5 h-4">{now ? formatDate(now) : ""}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden w-9 h-9 rounded-full bg-input-bg flex items-center justify-center text-muted"
                aria-label="チャンネル一覧を開く"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <Link
                href={`/${workspaceSlug}/search`}
                className="w-9 h-9 rounded-full bg-input-bg flex items-center justify-center text-muted"
                aria-label="検索"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                </svg>
              </Link>
            </div>
          </header>

          {/* 絞り込みチップ */}
          <div className="flex gap-2 mt-4 overflow-x-auto">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className={`shrink-0 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors ${
                  filter === chip.key ? "bg-accent text-white" : "bg-input-bg text-muted"
                }`}
              >
                {chip.label}
                {chip.count !== undefined && <span className="ml-1 font-bold">{chip.count}</span>}
              </button>
            ))}
          </div>

          {/* チャンネルカード */}
          <div className="mt-4 space-y-2.5">
            {visible.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface px-4 py-10 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-sm font-semibold text-foreground">
                  {filter === "mention" ? "自分宛ての未読はありません" : "全部読みました"}
                </p>
                <p className="text-xs text-muted mt-1">新しい投稿があるとここに集まります</p>
              </div>
            )}

            {visible.map((channel, index) => {
              const isExpanded = !!expanded[channel.id];
              const shown = isExpanded ? channel.messages : pickPreview(channel.messages);
              const rest = channel.unreadCount - shown.length;
              const isReplying = replyingId === channel.id;
              return (
                <section
                  key={channel.id}
                  className="animate-home-card-in rounded-2xl border border-border bg-surface shadow-sm px-3.5 pt-3 pb-2.5"
                  style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
                >
                  <Link href={`/${workspaceSlug}/${channel.slug}`} className="flex items-center gap-2">
                    <span className="w-[7px] h-[7px] rounded-full bg-accent shrink-0" aria-hidden="true" />
                    {channel.isDm ? (
                      channel.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={channel.iconUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-input-bg text-[10px] font-bold text-muted flex items-center justify-center shrink-0">
                          {channel.name.charAt(0)}
                        </span>
                      )
                    ) : (
                      <span className="text-accent font-extrabold text-sm shrink-0">#</span>
                    )}
                    <span className="text-sm font-bold text-foreground truncate">{channel.name}</span>
                    {channel.hasMention && (
                      <span className="shrink-0 text-[10px] font-extrabold text-white bg-mention rounded-full px-2 py-0.5">
                        @自分
                      </span>
                    )}
                    <span className="ml-auto shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center">
                      {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {now && channel.latestAt ? formatTime(channel.latestAt, now) : ""}
                    </span>
                  </Link>

                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {shown.map((message) =>
                      message.isMention ? (
                        <p
                          key={message.id}
                          className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-[13px] leading-snug text-foreground line-clamp-3"
                        >
                          <span className="font-bold mr-2">{message.senderName}</span>
                          {toPreview(message.content)}
                        </p>
                      ) : (
                        <p key={message.id} className="flex items-baseline gap-2 text-[13px] leading-snug">
                          <span className="font-bold text-foreground shrink-0">{message.senderName}</span>
                          <span className="text-muted truncate min-w-0">{toPreview(message.content)}</span>
                        </p>
                      )
                    )}
                  </div>

                  {rest > 0 &&
                    (channel.messages.length > shown.length ? (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [channel.id]: true }))}
                        className="mt-1.5 text-[11px] font-semibold text-accent"
                      >
                        ほか{rest}件を開く
                      </button>
                    ) : (
                      <Link
                        href={`/${workspaceSlug}/${channel.slug}`}
                        className="mt-1.5 inline-block text-[11px] font-semibold text-accent"
                      >
                        ほか{rest}件はチャンネルで見る
                      </Link>
                    ))}

                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openReply(channel.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent bg-accent-soft px-3 py-1.5 rounded-full"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5M4 9h10a6 6 0 016 6v4" />
                      </svg>
                      この会話に返信
                    </button>
                    <Link
                      href={`/${workspaceSlug}/${channel.slug}`}
                      className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-muted"
                    >
                      開く
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                      </svg>
                    </Link>
                  </div>

                  {isReplying && (
                    <form
                      className="mt-2.5 flex items-center gap-2 rounded-[18px] border border-border bg-background pl-3.5 pr-1.5 py-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void sendReply(channel);
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
                        placeholder={`${channel.isDm ? "" : "#"}${channel.name} に返信`}
                        className="flex-1 min-w-0 bg-transparent text-[16px] lg:text-sm text-foreground outline-none placeholder:text-muted"
                      />
                      <button
                        type="submit"
                        disabled={!replyText.trim() || sending}
                        className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0 disabled:opacity-40"
                        aria-label="送信"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </button>
                    </form>
                  )}
                </section>
              );
            })}
          </div>

          {/* 未読のないチャンネルは控えめに */}
          {filter === "all" && quietChannels.length > 0 && (
            <div className="mt-6">
              <p className="text-[11px] font-bold text-muted mb-2 px-1">静かなチャンネル</p>
              <div className="rounded-2xl border border-border-subtle">
                {quietChannels.map((channel, index) => (
                  <Link
                    key={channel.id}
                    href={`/${workspaceSlug}/${channel.slug}`}
                    className={`flex items-center gap-2 px-3.5 py-2.5 text-sm text-muted ${
                      index > 0 ? "border-t border-border-subtle" : ""
                    }`}
                  >
                    <span className="font-bold">#</span>
                    <span className="truncate">{channel.name}</span>
                    <svg className="ml-auto w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
