"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type ReactionActivity = {
  reaction_id: string;
  emoji: string;
  reacted_at: string;
  reactor_id: string;
  reactor_name: string;
  reactor_avatar: string | null;
  message_id: string;
  message_content: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
};

type MentionActivity = {
  mention_id: string;
  mentioned_at: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  message_id: string;
  message_content: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
};

type ReplyActivity = {
  reply_id: string;
  replied_at: string;
  replier_id: string;
  replier_name: string;
  replier_avatar: string | null;
  reply_content: string;
  parent_message_id: string;
  parent_content: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
};

type Tab = "reactions" | "mentions" | "replies";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  onClose: () => void;
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function previewContent(content: string): string {
  const firstLine =
    content.split("\n").find((l) => l.trim().length > 0 && !l.startsWith("https://")) || "";
  return firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return (
      <img
        src={url}
        alt={name}
        className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-xs font-bold text-accent">{(name || "?")[0]?.toUpperCase()}</span>
    </div>
  );
}

export function ActivityModal({ workspaceSlug, workspaceId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("mentions");
  const [reactions, setReactions] = useState<ReactionActivity[]>([]);
  const [mentions, setMentions] = useState<MentionActivity[]>([]);
  const [replies, setReplies] = useState<ReplyActivity[]>([]);
  // 各タブの読み込み済みフラグ（ロード前は loading 表示、後はキャッシュを再利用）
  const [loaded, setLoaded] = useState<Record<Tab, boolean>>({
    reactions: false,
    mentions: false,
    replies: false,
  });
  // 各タブに未読があるか（タブ名の右にドット表示）
  // モーダルを開いた瞬間にサーバから1回だけ取得し、以降はタブを開くごとに該当タブだけ false に落とす
  const [unread, setUnread] = useState<Record<Tab, boolean>>({
    reactions: false,
    mentions: false,
    replies: false,
  });

  // モーダルマウント時に一度だけ「どのタブに未読があるか」を取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_activity_unread_breakdown", {
        p_user_id: (await supabase.auth.getUser()).data.user?.id,
        p_workspace_id: workspaceId,
      });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setUnread({
          reactions: !!row.has_reactions,
          mentions: !!row.has_mentions,
          replies: !!row.has_replies,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // タブを開いた時に対応するデータと既読マークを取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      if (tab === "reactions" && !loaded.reactions) {
        const { data } = await supabase.rpc("get_my_activities", {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
          p_limit: 50,
        });
        if (cancelled) return;
        if (data && Array.isArray(data)) setReactions(data as ReactionActivity[]);
        await supabase.rpc("mark_activity_seen");
        setLoaded((s) => ({ ...s, reactions: true }));
      } else if (tab === "reactions") {
        // すでに読み込み済みでも、タブを再度開いたら既読更新
        await supabase.rpc("mark_activity_seen");
      }

      if (tab === "mentions" && !loaded.mentions) {
        const { data } = await supabase.rpc("get_my_mentions", {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
          p_limit: 50,
        });
        if (cancelled) return;
        if (data && Array.isArray(data)) setMentions(data as MentionActivity[]);
        await supabase.rpc("mark_mention_seen");
        setLoaded((s) => ({ ...s, mentions: true }));
      } else if (tab === "mentions") {
        await supabase.rpc("mark_mention_seen");
      }

      if (tab === "replies" && !loaded.replies) {
        const { data } = await supabase.rpc("get_my_replies", {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
          p_limit: 50,
        });
        if (cancelled) return;
        if (data && Array.isArray(data)) setReplies(data as ReplyActivity[]);
        await supabase.rpc("mark_reply_seen");
        setLoaded((s) => ({ ...s, replies: true }));
      } else if (tab === "replies") {
        await supabase.rpc("mark_reply_seen");
      }

      // 開いたタブのドットだけ即座に消す
      setUnread((u) => ({ ...u, [tab]: false }));

      // サイドバーのドットを即時に消す
      window.dispatchEvent(new CustomEvent("huddle:activitySeen"));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, workspaceId]);

  const tabLoading =
    (tab === "reactions" && !loaded.reactions) ||
    (tab === "mentions" && !loaded.mentions) ||
    (tab === "replies" && !loaded.replies);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-sidebar border border-border shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
          <h3 className="text-base font-bold text-foreground">アクティビティ</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground rounded transition-colors"
            aria-label="閉じる"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* タブバー */}
        <div className="flex border-b border-border/50 shrink-0">
          {([
            ["mentions", "メンション"],
            ["replies", "返信"],
            ["reactions", "リアクション"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                tab === key
                  ? "text-foreground border-b-2 border-accent -mb-px"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {label}
                {unread[key] && (
                  <span
                    aria-label="未読あり"
                    className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"
                  />
                )}
              </span>
            </button>
          ))}
        </div>

        <div
          className="flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar"
          style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
        >
          {tabLoading ? (
            <div className="text-center py-10 text-sm text-muted">読み込み中...</div>
          ) : tab === "reactions" ? (
            reactions.length === 0 ? (
              <EmptyState text="まだリアクションはありません" />
            ) : (
              <ul className="divide-y divide-border/50">
                {reactions.map((a) => (
                  <li key={a.reaction_id}>
                    <Link
                      href={`/${workspaceSlug}/${a.channel_slug}?m=${a.message_id}`}
                      onClick={onClose}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                    >
                      <Avatar url={a.reactor_avatar} name={a.reactor_name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">
                            {a.reactor_name}
                          </span>
                          <span className="text-sm">
                            が
                            {a.emoji.length <= 2 ? (
                              <span className="mx-1 text-base">{a.emoji}</span>
                            ) : (
                              <span className="mx-1 text-xs font-medium text-accent">
                                「{a.emoji}」
                              </span>
                            )}
                            でリアクション
                          </span>
                        </div>
                        <MetaLine channel={a.channel_name} time={a.reacted_at} />
                        <div className="text-xs text-muted mt-1 truncate">
                          {previewContent(a.message_content)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : tab === "mentions" ? (
            mentions.length === 0 ? (
              <EmptyState text="まだメンションはありません" />
            ) : (
              <ul className="divide-y divide-border/50">
                {mentions.map((a) => (
                  <li key={a.mention_id}>
                    <Link
                      href={`/${workspaceSlug}/${a.channel_slug}?m=${a.message_id}`}
                      onClick={onClose}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                    >
                      <Avatar url={a.author_avatar} name={a.author_name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">
                            {a.author_name}
                          </span>
                          <span className="text-sm">
                            があなたを
                            <span className="mx-1 text-xs font-medium text-accent">@メンション</span>
                          </span>
                        </div>
                        <MetaLine channel={a.channel_name} time={a.mentioned_at} />
                        <div className="text-xs text-muted mt-1 truncate">
                          {previewContent(a.message_content)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : replies.length === 0 ? (
            <EmptyState text="まだ返信はありません" />
          ) : (
            <ul className="divide-y divide-border/50">
              {replies.map((a) => (
                <li key={a.reply_id}>
                  <Link
                    href={`/${workspaceSlug}/${a.channel_slug}?m=${a.parent_message_id}`}
                    onClick={onClose}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                  >
                    <Avatar url={a.replier_avatar} name={a.replier_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">
                          {a.replier_name}
                        </span>
                        <span className="text-sm">があなたの投稿に返信</span>
                      </div>
                      <MetaLine channel={a.channel_name} time={a.replied_at} />
                      <div className="text-xs text-muted mt-1 truncate">
                        {previewContent(a.reply_content)}
                      </div>
                      <div className="text-[11px] text-muted/70 mt-0.5 truncate">
                        ↳ {previewContent(a.parent_content)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaLine({ channel, time }: { channel: string; time: string }) {
  return (
    <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
      <span className="shrink-0">#{channel}</span>
      <span>·</span>
      <span className="shrink-0">{formatRelative(time)}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12 text-sm text-muted px-6">
      <svg
        className="w-10 h-10 mx-auto mb-3 opacity-40"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
        />
      </svg>
      {text}
    </div>
  );
}
