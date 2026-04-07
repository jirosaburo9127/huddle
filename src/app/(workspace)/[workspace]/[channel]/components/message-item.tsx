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

// Supabase Storage URLかどうか判定
function isStorageFileUrl(content: string): boolean {
  const trimmed = content.trim();
  // 改行を含むテキストは通常メッセージとして扱う
  if (trimmed.includes("\n")) return false;
  return /^https:\/\/.*supabase.*\/storage\/v1\/object\/public\/chat-files\//.test(trimmed);
}

// 画像拡張子かどうか判定
function isImageFile(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url);
}

// URLからファイル名を抽出
function extractFileName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    const lastSegment = segments[segments.length - 1];
    // UUID-filename.ext の形式からファイル名部分を取得
    const match = lastSegment.match(/^[0-9a-f-]+-(.+)$/);
    return match ? decodeURIComponent(match[1]) : decodeURIComponent(lastSegment);
  } catch {
    return "ファイル";
  }
}

// メッセージ本文のレンダリング（ファイルURL対応）
function MessageContent({
  content,
  imageError,
  onImageError,
}: {
  content: string;
  imageError: boolean;
  onImageError: () => void;
}) {
  if (isStorageFileUrl(content)) {
    const url = content.trim();
    const fileName = extractFileName(url);

    // 画像ファイルの場合はプレビュー表示
    if (isImageFile(url) && !imageError) {
      return (
        <div className="mt-1">
          <img
            src={url}
            alt={fileName}
            className="max-w-xs max-h-80 rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(url, "_blank")}
            onError={onImageError}
          />
          <span className="text-xs text-muted mt-1 block">{fileName}</span>
        </div>
      );
    }

    // それ以外のファイルはリンク表示
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-border/50 hover:border-accent/30 transition-colors"
      >
        {/* ファイルアイコン */}
        <svg className="w-5 h-5 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm text-accent">{fileName}</span>
        {/* ダウンロードアイコン */}
        <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
    );
  }

  // 通常のテキストメッセージ
  return (
    <p className="text-[17px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
      {content}
    </p>
  );
}

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
  const [imageError, setImageError] = useState(false);
  const [showActions, setShowActions] = useState(false);
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
              <span className="font-semibold text-[15px] text-muted">
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-[13px] text-muted/70">{time}</span>
            </div>
          )}
          <p className="text-[17px] leading-relaxed text-muted italic">このメッセージは削除されました</p>
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
        onClick={() => setShowActions((v) => !v)}
      >
        {/* アバター or 左マージン（連続メッセージ時） */}
        {isConsecutive ? (
          <div className="shrink-0 w-9 flex items-center justify-center">
            {/* ホバー時に時刻を表示 */}
            <span className="text-xs text-muted/70 opacity-0 group-hover:opacity-100 transition-opacity select-none">
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
              <span className={`font-semibold text-[15px] ${isOwn ? "text-accent" : "text-foreground"}`}>
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-[13px] text-muted/70">{time}</span>
              {message.edited_at && (
                <span className="text-[13px] text-muted/70">(編集済み)</span>
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
              <MessageContent
                content={message.content}
                imageError={imageError}
                onImageError={() => setImageError(true)}
              />
              {/* 連続メッセージで編集済みの場合、本文の後に表示 */}
              {isConsecutive && message.edited_at && (
                <span className="text-xs text-muted/70">(編集済み)</span>
              )}
            </>
          )}

          {/* リアクションバッジ */}
          {groupedReactions.length > 0 && !isEditing && (
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

          {/* ホバー時アクションバー（Chatwork風：メッセージ本文の下にインライン表示） */}
          {/* アクションバー（PC: ホバー、モバイル: タップでトグル） */}
          {!isEditing && !isThreadView && (
          <div className={`transition-opacity mt-1 flex items-center gap-0.5 flex-wrap ${showActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {/* リアクション */}
            {onReact && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setEmojiPickerLocation((v) => v === "action" ? null : "action"); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  リアクション
                </button>
                {emojiPickerLocation === "action" && (
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setEmojiPickerLocation(null)}
                  />
                )}
              </div>
            )}
            {/* 返信 */}
            <button
              onClick={(e) => { e.stopPropagation(); onOpenThread?.(message); }}
              className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              返信
            </button>
            {/* 編集・削除は自分のメッセージのみ */}
            {isOwn && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditContent(message.content); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  編集
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsDeleting(true); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-mention border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  削除
                </button>
              </>
            )}
          </div>
        )}
        </div>
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
