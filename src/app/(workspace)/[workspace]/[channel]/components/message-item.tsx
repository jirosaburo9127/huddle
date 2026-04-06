"use client";

import { memo, useState, useRef, useEffect, useMemo } from "react";
import type { MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { EmojiPicker } from "./emoji-picker";

type Props = {
  message: MessageWithProfile;
  currentUserId: string;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onOpenThread?: (message: MessageWithProfile) => void;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  isThreadView?: boolean;
  isConsecutive?: boolean;
};

export const MessageItem = memo(function MessageItem({
  message,
  currentUserId,
  onEdit,
  onDelete,
  onOpenThread,
  onReact,
  isThreadView,
  isConsecutive,
}: Props) {
  const profile = message.profiles;
  const isOwn = message.user_id === currentUserId;
  const time = new Date(message.created_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const initial = (profile?.display_name || "?")[0].toUpperCase();
  // オンライン判定: last_seen_atが5分以内
  const isOnline = profile?.last_seen_at
    ? Date.now() - new Date(profile.last_seen_at).getTime() < 5 * 60 * 1000
    : false;

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [emojiPickerLocation, setEmojiPickerLocation] = useState<"action" | "inline" | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // リアクションを絵文字ごとにグループ化
  const groupedReactions = useMemo(() => {
    const reactions = message.reactions || [];
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      const list = map.get(r.emoji) || [];
      list.push(r);
      map.set(r.emoji, list);
    }
    return Array.from(map.entries()).map(([emoji, list]) => ({
      emoji,
      count: list.length,
      reacted: list.some((r) => r.user_id === currentUserId),
    }));
  }, [message.reactions, currentUserId]);

  // 絵文字ピッカーで選択時
  function handleEmojiSelect(emoji: string) {
    setEmojiPickerLocation(null);
    onReact?.(message.id, emoji);
  }

  // 編集モード開始時にフォーカス
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length
      );
    }
  }, [isEditing]);

  // 削除済みメッセージ
  if (message.deleted_at) {
    return (
      <div className={`flex gap-3 px-2 rounded-lg ${isConsecutive ? "py-0.5 pl-[60px]" : "pt-3 pb-1"}`}>
        {!isConsecutive && (
          <div className="shrink-0 w-9 h-9 rounded-full bg-border/30 flex items-center justify-center text-muted text-[13px] mt-0.5">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {!isConsecutive && (
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-[13px] text-muted">
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-[11px] text-muted/70">{time}</span>
            </div>
          )}
          <p className="text-[15px] leading-relaxed text-muted italic">このメッセージは削除されました</p>
        </div>
      </div>
    );
  }

  async function handleSaveEdit() {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(false);
    await onDelete(message.id);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      setIsEditing(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    }
  }

  return (
    <>
      <div
        className={`group relative flex gap-3 px-2 rounded-lg hover:bg-white/[0.02] transition-colors ${
          isConsecutive ? "py-0.5" : "pt-3 pb-1"
        }`}
      >
        {/* アバター or 左マージン（連続メッセージ時） */}
        {isConsecutive ? (
          <div className="shrink-0 w-9 flex items-center justify-center">
            {/* ホバー時に時刻を表示 */}
            <span className="text-[11px] text-muted/70 opacity-0 group-hover:opacity-100 transition-opacity select-none">
              {time}
            </span>
          </div>
        ) : (
          <div className="relative shrink-0 w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[13px] font-bold mt-0.5">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.display_name}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              initial
            )}
            {/* オンラインドット */}
            {isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-online border-2 border-background" />
            )}
          </div>
        )}

        {/* メッセージ本文 */}
        <div className="min-w-0 flex-1">
          {/* ユーザー名と時刻（先頭メッセージのみ） */}
          {!isConsecutive && (
            <div className="flex items-baseline gap-2">
              <span className={`font-semibold text-[13px] ${isOwn ? "text-accent" : "text-foreground"}`}>
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-[11px] text-muted/70">{time}</span>
              {message.edited_at && (
                <span className="text-[11px] text-muted/70">(編集済み)</span>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={editTextareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full resize-none rounded-lg border border-border bg-input-bg px-3 py-2 text-[15px] leading-relaxed text-foreground focus:border-accent focus:outline-none"
                rows={2}
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg px-3 py-1 text-xs text-muted hover:text-foreground transition-colors"
                >
                  キャンセル
                </button>
                <span className="text-xs text-muted ml-auto">Escでキャンセル</span>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                {message.content}
              </p>
              {/* 連続メッセージで編集済みの場合、本文の後に表示 */}
              {isConsecutive && message.edited_at && (
                <span className="text-[11px] text-muted/70">(編集済み)</span>
              )}
            </>
          )}

          {/* リアクションバッジ */}
          {(groupedReactions.length > 0 || onReact) && !isEditing && (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {groupedReactions.map(({ emoji, count, reacted }) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact?.(message.id, emoji)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${
                    reacted
                      ? "bg-accent/10 border-accent/30 text-accent"
                      : "bg-white/[0.03] border-border/50 text-muted hover:border-accent/30"
                  }`}
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </button>
              ))}
              {/* 絵文字追加ボタン */}
              {onReact && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEmojiPickerLocation((v) => v === "inline" ? null : "inline")}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs border border-border/50 text-muted hover:border-accent/30 hover:text-accent cursor-pointer transition-colors"
                  >
                    +
                  </button>
                  {emojiPickerLocation === "inline" && (
                    <EmojiPicker
                      onSelect={handleEmojiSelect}
                      onClose={() => setEmojiPickerLocation(null)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* スレッド返信数 */}
          {message.reply_count > 0 && !isThreadView && (
            <button
              onClick={() => onOpenThread?.(message)}
              className="mt-1 text-xs text-accent hover:underline"
            >
              {message.reply_count}件の返信
            </button>
          )}
        </div>

        {/* ホバー時アクションボタン */}
        {!isEditing && !isThreadView && (
          <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-sidebar/95 backdrop-blur-sm border border-border/60 rounded-xl px-1.5 py-1 shadow-xl">
            {/* リアクションボタン */}
            {onReact && (
              <div className="relative">
                <button
                  onClick={() => setEmojiPickerLocation((v) => v === "action" ? null : "action")}
                  className="p-1 text-muted hover:text-foreground rounded transition-colors"
                  title="リアクション"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                {emojiPickerLocation === "action" && (
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setEmojiPickerLocation(null)}
                  />
                )}
              </div>
            )}
            {/* 返信ボタン */}
            <button
              onClick={() => onOpenThread?.(message)}
              className="p-1 text-muted hover:text-foreground rounded transition-colors"
              title="返信"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
            {/* 編集・削除は自分のメッセージのみ */}
            {isOwn && (
              <>
                <button
                  onClick={() => {
                    setIsEditing(true);
                    setEditContent(message.content);
                  }}
                  className="p-1 text-muted hover:text-foreground rounded transition-colors"
                  title="編集"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsDeleting(true)}
                  className="p-1 text-muted hover:text-mention rounded transition-colors"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 削除確認ダイアログ */}
      {isDeleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl bg-sidebar border border-border p-6 space-y-4">
            <h3 className="text-lg font-bold">メッセージを削除</h3>
            <div className="rounded-lg bg-background/50 p-3 text-sm text-muted">
              {message.content}
            </div>
            <p className="text-sm text-muted">このメッセージを削除しますか？</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsDeleting(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-mention px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-colors"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
