"use client";

import { memo, useState, useRef, useEffect } from "react";
import type { MessageWithProfile } from "@/lib/supabase/types";

type Props = {
  message: MessageWithProfile;
  currentUserId: string;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onOpenThread?: (message: MessageWithProfile) => void;
  isThreadView?: boolean;
};

export const MessageItem = memo(function MessageItem({
  message,
  currentUserId,
  onEdit,
  onDelete,
  onOpenThread,
  isThreadView,
}: Props) {
  const profile = message.profiles;
  const isOwn = message.user_id === currentUserId;
  const time = new Date(message.created_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const initial = (profile?.display_name || "?")[0].toUpperCase();

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

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
      <div className="flex gap-3 px-2 py-1.5 rounded-lg">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-border/30 flex items-center justify-center text-muted text-sm mt-0.5">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-sm text-muted">
              {profile?.display_name || "不明なユーザー"}
            </span>
            <span className="text-xs text-muted">{time}</span>
          </div>
          <p className="text-sm text-muted italic">このメッセージは削除されました</p>
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
      <div className="group relative flex gap-3 px-2 py-1.5 rounded-lg hover:bg-sidebar-hover/30 transition-colors">
        {/* アバター */}
        <div className="shrink-0 w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center text-accent text-sm font-bold mt-0.5">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.display_name}
              className="w-9 h-9 rounded-lg object-cover"
            />
          ) : (
            initial
          )}
        </div>

        {/* メッセージ本文 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`font-bold text-sm ${isOwn ? "text-accent" : "text-foreground"}`}>
              {profile?.display_name || "不明なユーザー"}
            </span>
            <span className="text-xs text-muted">{time}</span>
            {message.edited_at && (
              <span className="text-xs text-muted">(編集済み)</span>
            )}
          </div>

          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={editTextareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full resize-none rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
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
            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
              {message.content}
            </p>
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
          <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-sidebar border border-border rounded-lg px-1 py-0.5 shadow-lg">
            {/* 返信ボタン */}
            <button
              onClick={() => onOpenThread?.(message)}
              className="p-1 text-muted hover:text-foreground rounded transition-colors"
              title="返信"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsDeleting(true)}
                  className="p-1 text-muted hover:text-mention rounded transition-colors"
                  title="削除"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
