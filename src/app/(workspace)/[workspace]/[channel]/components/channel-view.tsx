"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import type { Channel, Message, MessageWithProfile } from "@/lib/supabase/types";
import { MessageItem } from "./message-item";
import { MessageInput } from "./message-input";
import { ThreadPanel } from "./thread-panel";

type Props = {
  channel: Channel;
  initialMessages: MessageWithProfile[];
  currentUserId: string;
};

export function ChannelView({ channel, initialMessages, currentUserId }: Props) {
  const [messages, setMessages] = useState<MessageWithProfile[]>(initialMessages);
  const [activeThread, setActiveThread] = useState<MessageWithProfile | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(initialMessages.length);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // スレッドを開く
  const handleOpenThread = useCallback((msg: MessageWithProfile) => {
    setActiveThread(msg);
  }, []);

  // スレッド返信数の変更を親メッセージに反映
  const handleReplyCountChange = useCallback((parentId: string, delta: number) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === parentId ? { ...m, reply_count: m.reply_count + delta } : m
      )
    );
    // activeThreadも更新
    setActiveThread((prev) =>
      prev && prev.id === parentId
        ? { ...prev, reply_count: prev.reply_count + delta }
        : prev
    );
  }, []);

  // 新着メッセージ追加時のみ自動スクロール
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // Realtime購読
  useEffect(() => {
    const subscription = supabase
      .channel(`messages:${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        async (payload: RealtimePostgresInsertPayload<Message>) => {
          // parent_idがあるものはスレッド返信なので無視
          if (payload.new.parent_id) return;

          // 自分が送ったメッセージは楽観的更新済みなのでスキップ
          if (payload.new.user_id === currentUserId) return;

          // プロフィール情報を取得
          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", payload.new.user_id)
            .single();

          const newMessage = {
            ...payload.new,
            profiles: profile,
          } as unknown as MessageWithProfile;

          setMessages((prev) => {
            // 重複チェック
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload: RealtimePostgresUpdatePayload<Message>) => {
          const updated = payload.new;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? { ...m, content: updated.content, edited_at: updated.edited_at, deleted_at: updated.deleted_at, reply_count: updated.reply_count }
                : m
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // メッセージ編集
  const handleEdit = useCallback(async (messageId: string, newContent: string) => {
    setMessages((prev) =>
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
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? data as MessageWithProfile : m))
        );
      }
    }
  }, [supabase]);

  // メッセージ削除（ソフトデリート）
  const handleDelete = useCallback(async (messageId: string) => {
    setMessages((prev) =>
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
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? data as MessageWithProfile : m))
        );
      }
    }
  }, [supabase]);

  // メッセージ送信
  async function handleSend(content: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 楽観的UI更新
    const optimisticMsg: MessageWithProfile = {
      id: crypto.randomUUID(),
      channel_id: channel.id,
      user_id: user.id,
      parent_id: null,
      content,
      edited_at: null,
      deleted_at: null,
      reply_count: 0,
      created_at: new Date().toISOString(),
      profiles: {
        id: user.id,
        email: user.email || "",
        display_name: user.user_metadata?.display_name || user.email?.split("@")[0] || "",
        avatar_url: null,
        status: null,
        last_seen_at: null,
      },
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    const { data, error } = await supabase.from("messages").insert({
      channel_id: channel.id,
      user_id: user.id,
      content,
    }).select().single();

    if (error) {
      // 失敗時は楽観的更新を取り消し
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } else if (data) {
      // 楽観的メッセージのIDをDB側のIDに置き換え
      setMessages((prev) =>
        prev.map((m) => m.id === optimisticMsg.id ? { ...m, id: data.id, created_at: data.created_at } : m)
      );
    }
  }

  return (
    <div className="flex h-full">
      {/* チャンネルエリア */}
      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* チャンネルヘッダー */}
        <header className="flex items-center px-4 py-3 border-b border-border bg-header shrink-0">
          <div className="flex items-center gap-2 pl-10 lg:pl-0">
            <span className="text-muted font-medium">#</span>
            <h1 className="font-bold text-lg">{channel.name}</h1>
          </div>
          {channel.topic && (
            <span className="ml-4 text-sm text-muted truncate hidden sm:inline">
              {channel.topic}
            </span>
          )}
        </header>

        {/* メッセージ一覧 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted">
              <p className="text-lg font-medium">#{channel.name} へようこそ</p>
              <p className="text-sm mt-1">最初のメッセージを送信しましょう</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {messages.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  currentUserId={currentUserId}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onOpenThread={handleOpenThread}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* メッセージ入力 */}
        <MessageInput
          channelName={channel.name}
          onSend={handleSend}
        />
      </div>

      {/* スレッドパネル */}
      {activeThread && (
        <ThreadPanel
          parentMessage={activeThread}
          currentUserId={currentUserId}
          channelId={channel.id}
          onClose={() => setActiveThread(null)}
          onReplyCountChange={handleReplyCountChange}
        />
      )}
    </div>
  );
}
