"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import type { Message, MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { MessageItem } from "./message-item";
import { MessageInput } from "./message-input";
import { showMessageNotification } from "@/lib/notification";

type Props = {
  parentMessage: MessageWithProfile;
  currentUserId: string;
  channelId: string;
  workspaceId?: string;
  onClose: () => void;
  onReplyCountChange: (parentId: string, delta: number) => void;
  onDecision?: (messageId: string, isDecision: boolean) => Promise<void>;
  onBookmark?: (messageId: string) => Promise<void>;
  bookmarkedIds?: Set<string>;
};

export function ThreadPanel({
  parentMessage,
  currentUserId,
  channelId,
  workspaceId,
  onClose,
  onReplyCountChange,
  onDecision,
  onBookmark,
  bookmarkedIds,
}: Props) {
  const [replies, setReplies] = useState<MessageWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const repliesEndRef = useRef<HTMLDivElement>(null);
  const prevReplyCountRef = useRef(0);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  // 自タブで楽観的反映済みの返信ID集合（PCとiPhoneで同一ユーザーログイン時の同期問題対策）
  const sentReplyIdsRef = useRef<Set<string>>(new Set());

  // 新着返信時のみ自動スクロール
  useEffect(() => {
    if (replies.length > prevReplyCountRef.current) {
      repliesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevReplyCountRef.current = replies.length;
  }, [replies.length]);

  // 初回フェッチ + Realtime購読
  useEffect(() => {
    let mounted = true;

    async function fetchReplies() {
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(*), reactions(*)")
        .eq("parent_id", parentMessage.id)
        .order("created_at", { ascending: true });

      if (mounted && data) {
        setReplies(data as MessageWithProfile[]);
      }
      if (mounted) setLoading(false);
    }

    fetchReplies();

    // Realtime購読
    const subscription = supabase
      .channel(`thread:${parentMessage.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `parent_id=eq.${parentMessage.id}`,
        },
        async (payload: RealtimePostgresInsertPayload<Message>) => {
          // このタブで楽観的に追加済みの返信はスキップ
          // （user_idで判定すると別端末からの同一ユーザーの返信が届かなくなる）
          if (sentReplyIdsRef.current.has(payload.new.id)) {
            sentReplyIdsRef.current.delete(payload.new.id);
            return;
          }

          // プロフィール情報を取得
          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", payload.new.user_id)
            .single();

          const newReply = {
            ...payload.new,
            profiles: profile,
          } as unknown as MessageWithProfile;

          setReplies((prev) => {
            if (prev.some((m) => m.id === newReply.id)) return prev;
            return [...prev, newReply];
          });

          // スレッド返信の通知
          showMessageNotification({
            senderName: profile?.display_name || "不明",
            channelName: "スレッド",
            content: payload.new.content,
            url: window.location.pathname,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `parent_id=eq.${parentMessage.id}`,
        },
        (payload: RealtimePostgresUpdatePayload<Message>) => {
          const updated = payload.new;
          setReplies((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? {
                    ...m,
                    content: updated.content,
                    edited_at: updated.edited_at,
                    deleted_at: updated.deleted_at,
                  }
                : m
            )
          );
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(subscription);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentMessage.id]);

  // 返信の編集
  const handleEdit = useCallback(
    async (messageId: string, newContent: string) => {
      setReplies((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: newContent, edited_at: new Date().toISOString() }
            : m
        )
      );

      const { error } = await supabase
        .from("messages")
        .update({ content: newContent, edited_at: new Date().toISOString() })
        .eq("id", messageId);

      if (error) {
        const { data } = await supabase
          .from("messages")
          .select("*, profiles(*)")
          .eq("id", messageId)
          .single();
        if (data) {
          setReplies((prev) =>
            prev.map((m) =>
              m.id === messageId ? (data as MessageWithProfile) : m
            )
          );
        }
      }
    },
    [supabase]
  );

  // 返信の削除（ソフトデリート）
  const handleDelete = useCallback(
    async (messageId: string) => {
      setReplies((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deleted_at: new Date().toISOString() }
            : m
        )
      );

      const { error } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId);

      if (error) {
        const { data } = await supabase
          .from("messages")
          .select("*, profiles(*)")
          .eq("id", messageId)
          .single();
        if (data) {
          setReplies((prev) =>
            prev.map((m) =>
              m.id === messageId ? (data as MessageWithProfile) : m
            )
          );
        }
      }
    },
    [supabase]
  );

  // リアクション追加/削除（トグル）
  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      // 親メッセージまたは返信のどちらかからリアクションを探す
      const targetMsg =
        messageId === parentMessage.id
          ? parentMessage
          : replies.find((m) => m.id === messageId);
      const existingReaction = targetMsg?.reactions?.find(
        (r) => r.emoji === emoji && r.user_id === currentUserId
      );

      const updateReactions = (
        prev: MessageWithProfile[],
        msgId: string,
        updater: (reactions: Reaction[]) => Reaction[]
      ) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, reactions: updater(m.reactions || []) } : m
        );

      if (existingReaction) {
        // 削除（トグル）
        setReplies((prev) =>
          updateReactions(prev, messageId, (rs) =>
            rs.filter((r) => r.id !== existingReaction.id)
          )
        );
        await supabase.from("reactions").delete().eq("id", existingReaction.id);
      } else {
        // 追加
        const optimisticReaction: Reaction = {
          id: crypto.randomUUID(),
          message_id: messageId,
          user_id: currentUserId,
          emoji,
          created_at: new Date().toISOString(),
        };
        setReplies((prev) =>
          updateReactions(prev, messageId, (rs) => [...rs, optimisticReaction])
        );
        const { data } = await supabase
          .from("reactions")
          .insert({ message_id: messageId, user_id: currentUserId, emoji })
          .select()
          .single();
        if (data) {
          setReplies((prev) =>
            updateReactions(prev, messageId, (rs) =>
              rs.map((r) =>
                r.id === optimisticReaction.id ? { ...r, id: data.id } : r
              )
            )
          );
        }
      }
    },
    [supabase, currentUserId, parentMessage, replies]
  );

  // 返信送信
  async function handleSend(content: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // 楽観的UI更新
    const optimisticReply: MessageWithProfile = {
      id: crypto.randomUUID(),
      channel_id: channelId,
      user_id: user.id,
      parent_id: parentMessage.id,
      content,
      edited_at: null,
      deleted_at: null,
      is_decision: false,
      reply_count: 0,
      created_at: new Date().toISOString(),
      profiles: {
        id: user.id,
        email: user.email || "",
        display_name:
          user.user_metadata?.display_name ||
          user.email?.split("@")[0] ||
          "",
        avatar_url: null,
        status: null,
        last_seen_at: null,
      },
    };

    setReplies((prev) => [...prev, optimisticReply]);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        user_id: user.id,
        parent_id: parentMessage.id,
        content,
      })
      .select()
      .single();

    if (error) {
      // 失敗時は楽観的更新を取り消し
      setReplies((prev) => prev.filter((m) => m.id !== optimisticReply.id));
      return;
    }

    if (data) {
      // Realtime購読の二重追加を防ぐためDB IDを記録し、楽観的IDをDB IDに置換
      sentReplyIdsRef.current.add(data.id);
      setReplies((prev) =>
        prev.map((m) =>
          m.id === optimisticReply.id
            ? { ...m, id: data.id, created_at: data.created_at }
            : m
        )
      );
    }

    // reply_countはDBトリガーで自動更新される。UIも即座に反映
    onReplyCountChange(parentMessage.id, 1);
  }

  // 返信数（楽観的更新を反映）
  const replyCount = replies.length;

  return (
    <div className="fixed inset-0 z-40 bg-background lg:static lg:inset-auto lg:z-auto lg:w-96 lg:border-l lg:border-border flex flex-col h-full animate-slide-in-right">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-header shrink-0">
        <h2 className="font-bold text-xl">スレッド</h2>
        <button
          onClick={onClose}
          className="p-1 text-muted hover:text-foreground rounded transition-colors"
          title="閉じる"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </header>

      {/* スレッド本文 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* 親メッセージ */}
        <MessageItem
          message={parentMessage}
          currentUserId={currentUserId}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReact={handleReact}
          onDecision={onDecision}
          onBookmark={onBookmark}
          isBookmarked={bookmarkedIds?.has(parentMessage.id)}
          isThreadView
        />

        {/* 区切り線 */}
        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted shrink-0">
            {loading ? "読み込み中..." : `${replyCount}件の返信`}
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* 返信一覧 */}
        <div>
          {replies.map((reply, index) => {
            const prev = index > 0 ? replies[index - 1] : null;
            // 連続メッセージ判定: 同一ユーザーかつ5分以内
            const isConsecutive =
              prev !== null &&
              prev.user_id === reply.user_id &&
              !prev.deleted_at &&
              new Date(reply.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;

            return (
              <MessageItem
                key={reply.id}
                message={reply}
                currentUserId={currentUserId}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onReact={handleReact}
                onDecision={onDecision}
                onBookmark={onBookmark}
                isBookmarked={bookmarkedIds?.has(reply.id)}
                isThreadView
                isConsecutive={isConsecutive}
              />
            );
          })}
        </div>
        <div ref={repliesEndRef} />
      </div>

      {/* 返信入力 */}
      <MessageInput onSend={handleSend} placeholder="返信を入力" channelId={channelId} workspaceId={workspaceId} />
    </div>
  );
}
