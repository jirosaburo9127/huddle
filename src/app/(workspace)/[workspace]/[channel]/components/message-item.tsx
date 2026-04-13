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
  onDecision?: (messageId: string, isDecision: boolean) => Promise<void>;
  onUpdateDecisionMeta?: (
    messageId: string,
    why: string | null,
    due: string | null
  ) => Promise<void>;
  onBookmark?: (messageId: string) => Promise<void>;
  isBookmarked?: boolean;
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

// HTMLタグをエスケープ（XSS対策）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// MarkdownをパースしてHTML文字列に変換（最小対応）
function parseMarkdown(text: string): string {
  // まずHTMLタグをエスケープ
  let html = escapeHtml(text);

  // コードブロック（```...```）
  html = html.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    return `<pre class="bg-white/[0.06] rounded-lg p-3 my-1 overflow-x-auto"><code class="text-sm font-mono">${code.trim()}</code></pre>`;
  });

  // インラインコード（`...`）
  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return `<code class="bg-white/[0.06] px-1.5 py-0.5 rounded text-sm font-mono">${code}</code>`;
  });

  // 太字（**...**）
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 危険なURLスキームをブロック（javascript:, vbscript:, data:（画像以外））
  html = html.replace(/(?:javascript|vbscript):/gi, "blocked:");
  html = html.replace(/data:(?!image\/)/gi, "blocked:");

  // URLの自動リンク化（コードブロック/インラインコード内を除く）
  html = html.replace(
    /(?<!["=])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">$1</a>'
  );

  // @メンション（全角・半角文字＋非ブレークスペース対応）
  // U+00A0 (non-breaking space) を許可することで、「奥 純香」のように
  // 空白を含む表示名のメンションを 1 トークンとしてハイライトできる
  html = html.replace(
    /@([\w\u3000-\u9FFF\uF900-\uFAFF\u00A0]+)/g,
    (_m, name: string) =>
      `<span class="text-accent font-semibold">@${name.replace(/\u00A0/g, " ")}</span>`
  );

  return html;
}

// メッセージ本文のレンダリング（ファイルURL対応 + Markdown）
function MessageContent({
  content,
  imageError,
  onImageError,
  onImageClick,
}: {
  content: string;
  imageError: boolean;
  onImageError: () => void;
  onImageClick?: (url: string) => void;
}) {
  if (isStorageFileUrl(content)) {
    const url = content.trim();
    const fileName = extractFileName(url);

    // 画像ファイルの場合はプレビュー表示（タップでアプリ内ライトボックス）
    if (isImageFile(url) && !imageError) {
      return (
        <div className="mt-1">
          <img
            src={url}
            alt={fileName}
            className="max-w-xs max-h-80 rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onImageClick?.(url);
            }}
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

  // Markdownパース済みHTML
  const html = parseMarkdown(content);

  return (
    <div
      className="text-lg leading-[1.7] text-foreground whitespace-pre-wrap break-words [&_pre]:whitespace-pre [&_pre]:my-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// リアクションバッジコンポーネント（PC: ホバーツールチップ、モバイル: 長押しモーダル）
function ReactionBadges({
  reactions,
  onReact,
}: {
  reactions: Array<{ emoji: string; count: number; reacted: boolean; names: string[] }>;
  onReact?: (emoji: string) => void;
}) {
  const [longPressNames, setLongPressNames] = useState<{ emoji: string; names: string[] } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTouchStart(emoji: string, names: string[]) {
    longPressTimer.current = setTimeout(() => {
      setLongPressNames({ emoji, names });
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {reactions.map(({ emoji, count, reacted, names }) => (
          <div key={emoji} className="relative group/reaction">
            <button
              type="button"
              onClick={() => onReact?.(emoji)}
              onTouchStart={(e) => { e.preventDefault(); handleTouchStart(emoji, names); }}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border cursor-pointer transition-colors select-none ${
                reacted
                  ? "bg-accent/10 border-accent/30 text-accent"
                  : "bg-white/[0.03] border-border/50 text-muted hover:border-accent/30"
              }`}
            >
              <span className="text-base">{emoji}</span>
              <span>{count}</span>
            </button>
            {/* PC: ホバーツールチップ */}
            {names.length > 0 && (
              <div className="hidden lg:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium whitespace-nowrap opacity-0 group-hover/reaction:opacity-100 pointer-events-none transition-opacity duration-100 z-20">
                {names.join("、")}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>
      {/* モバイル: 長押しモーダル */}
      {longPressNames && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center lg:hidden"
          onClick={() => setLongPressNames(null)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-sidebar border border-border rounded-2xl px-5 py-4 max-w-xs w-full mx-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{longPressNames.emoji}</span>
              <span className="text-base font-semibold text-foreground">リアクションした人</span>
            </div>
            <div className="space-y-2">
              {longPressNames.names.map((name) => (
                <div key={name} className="text-sm text-foreground">{name}</div>
              ))}
            </div>
            <button
              onClick={() => setLongPressNames(null)}
              className="mt-4 w-full py-2 text-sm text-muted hover:text-foreground rounded-xl border border-border/50 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  currentUserId,
  onEdit,
  onDelete,
  onOpenThread,
  onReact,
  onDecision,
  onUpdateDecisionMeta,
  onBookmark,
  isBookmarked,
  isThreadView,
  isConsecutive,
}: Props) {
  const profile = message.profiles;
  const isOwn = message.user_id === currentUserId;
  // timeZone を固定して SSR/CSR の hydration mismatch を防ぐ
  const time = new Date(message.created_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
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
  const [mobileEmojiOpen, setMobileEmojiOpen] = useState(false);

  // 他所で「すべてのアクションメニューを閉じて」と言われたら閉じる。
  // スレッドを開いた瞬間にアクションシート/絵文字ピッカーを自動で畳むのに使う。
  useEffect(() => {
    function close() {
      setShowActions(false);
      setMobileEmojiOpen(false);
    }
    window.addEventListener("huddle:closeAllActions", close);
    return () => window.removeEventListener("huddle:closeAllActions", close);
  }, []);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showDecisionMetaModal, setShowDecisionMetaModal] = useState(false);
  const [metaWhyInput, setMetaWhyInput] = useState("");
  const [metaDueInput, setMetaDueInput] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);
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
      names: list.map((r) => r.display_name || "").filter(Boolean),
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
              <span className="font-semibold text-base text-muted">
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-sm text-muted/70">{time}</span>
            </div>
          )}
          <p className="text-lg leading-[1.7] text-muted italic">このメッセージは削除されました</p>
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
          isConsecutive ? "py-1" : "pt-3 pb-1"
        }`}
        onClick={() => {
          // スレッド表示中はアクションシートを出さない（返信画面に入った後に
          // リアクション一覧が残り続ける問題の防止）
          if (isThreadView) return;
          setShowActions((v) => !v);
        }}
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
              <span className={`font-semibold text-base ${isOwn ? "text-accent" : "text-foreground"}`}>
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-sm text-muted/70">{time}</span>
              {message.edited_at && (
                <span className="text-sm text-muted/70">(編集済み)</span>
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
                onImageClick={setLightboxUrl}
              />
              {/* 連続メッセージで編集済みの場合、本文の後に表示 */}
              {isConsecutive && message.edited_at && (
                <span className="text-xs text-muted/70">(編集済み)</span>
              )}
            </>
          )}

          {/* 決定事項マーカー + Why/Due + 編集 */}
          {message.is_decision && !isEditing && (
            <div className="mt-1 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 text-sm text-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">✅ 決定事項</span>
                {onUpdateDecisionMeta && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMetaWhyInput(message.decision_why || "");
                      setMetaDueInput(message.decision_due || "");
                      setShowDecisionMetaModal(true);
                    }}
                    className="text-xs text-accent/80 hover:text-accent underline decoration-dotted"
                  >
                    {message.decision_why || message.decision_due ? "編集" : "理由・期限を追記"}
                  </button>
                )}
              </div>
              {(message.decision_why || message.decision_due) && (
                <div className="mt-2 pt-2 border-t border-accent/20 space-y-1 text-xs text-foreground/90">
                  {message.decision_why && (
                    <div className="flex gap-2">
                      <span className="shrink-0 font-semibold text-muted uppercase">
                        Why
                      </span>
                      <span className="whitespace-pre-wrap break-words">
                        {message.decision_why}
                      </span>
                    </div>
                  )}
                  {message.decision_due && (
                    <div className="flex gap-2">
                      <span className="shrink-0 font-semibold text-muted uppercase">
                        Due
                      </span>
                      <span className="whitespace-pre-wrap break-words">
                        {message.decision_due}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 決定事項 Why/Due 編集モーダル */}
          {showDecisionMetaModal && onUpdateDecisionMeta && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-sidebar border border-border p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">決定事項の追記</h3>
                  <button
                    type="button"
                    onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
                    className="text-muted hover:text-foreground"
                    aria-label="閉じる"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase mb-1">
                    Why（理由・背景）
                  </label>
                  <textarea
                    value={metaWhyInput}
                    onChange={(e) => setMetaWhyInput(e.target.value)}
                    placeholder="なぜこの決定に至ったか"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase mb-1">
                    Due（期限・期日）
                  </label>
                  <input
                    type="text"
                    value={metaDueInput}
                    onChange={(e) => setMetaDueInput(e.target.value)}
                    placeholder="例: 2026/05/15 / 月末まで / 次回MTGまで"
                    className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-border text-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={metaSaving}
                    onClick={async () => {
                      setMetaSaving(true);
                      try {
                        await onUpdateDecisionMeta(
                          message.id,
                          metaWhyInput.trim() || null,
                          metaDueInput.trim() || null
                        );
                        setShowDecisionMetaModal(false);
                      } finally {
                        setMetaSaving(false);
                      }
                    }}
                    className="px-4 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {metaSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* リアクションバッジ */}
          {groupedReactions.length > 0 && !isEditing && (
            <ReactionBadges
              reactions={groupedReactions}
              onReact={onReact ? (emoji: string) => onReact(message.id, emoji) : undefined}
            />
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

          {/* PC: アクションバー（ホバーで表示、メッセージ右上に浮かせる） */}
          {!isEditing && !isThreadView && (
          <div className="hidden lg:flex absolute -top-2 right-3 z-10 transition-opacity items-center gap-0.5 bg-sidebar/95 backdrop-blur-sm border border-border/60 rounded-lg px-1 py-0.5 shadow-lg opacity-0 group-hover:opacity-100">
            {/* 決定ボタンは一番左 — Huddleの推し機能なので最も発見しやすい位置 */}
            {onDecision && (
              <button
                onClick={(e) => { e.stopPropagation(); onDecision(message.id, !message.is_decision); }}
                className={`flex items-center gap-1 px-2.5 py-1 text-[13px] font-medium border rounded-md transition-all active:scale-90 ${
                  message.is_decision
                    ? "text-accent border-accent/40 bg-accent/10"
                    : "text-muted hover:text-accent border-transparent hover:border-accent/30 hover:bg-accent/5"
                }`}
              >
                <svg className="w-4 h-4" fill={message.is_decision ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {message.is_decision ? "決定済" : "決定"}
              </button>
            )}
            <div className="w-px h-4 bg-border/50 mx-0.5" />
            {onReact && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setEmojiPickerLocation((v) => v === "action" ? null : "action"); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <button
              onClick={(e) => { e.stopPropagation(); onOpenThread?.(message); }}
              className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              返信
            </button>
            {/* ブックマーク */}
            {onBookmark && (
              <button
                onClick={(e) => { e.stopPropagation(); onBookmark(message.id); }}
                className={`flex items-center gap-1 px-2 py-0.5 text-[13px] border border-transparent hover:border-border/50 rounded transition-colors ${
                  isBookmarked ? "text-accent" : "text-muted hover:text-accent"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                保存
              </button>
            )}
            {isOwn && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditContent(message.content); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  編集
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsDeleting(true); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-mention border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* モバイル: Chatwork風アクションモーダル */}
      {showActions && !isEditing && !isThreadView && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center lg:hidden"
          onClick={(e) => { e.stopPropagation(); setShowActions(false); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-sm mx-4 mb-6 rounded-2xl bg-sidebar border border-border p-5 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-3">
              {/* 返信 */}
              <button
                onClick={() => { setShowActions(false); onOpenThread?.(message); }}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">返信</span>
              </button>
              {/* 決定事項トグル（モバイル）— Huddleの推し機能、最も目立つ位置 */}
              {onDecision && (
                <button
                  onClick={() => { setShowActions(false); onDecision(message.id, !message.is_decision); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] active:scale-90 transition-all"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${message.is_decision ? "border-accent bg-accent/15" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${message.is_decision ? "text-accent" : "text-foreground"}`} fill={message.is_decision ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <span className={`text-xs ${message.is_decision ? "text-accent font-semibold" : "text-foreground"}`}>
                    {message.is_decision ? "決定済" : "決定"}
                  </span>
                </button>
              )}
              {/* リアクション */}
              {onReact && (
                <button
                  onClick={() => setMobileEmojiOpen(true)}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">リアクション</span>
                </button>
              )}
              {/* モバイル絵文字グリッド（アクションモーダル内） */}
              {mobileEmojiOpen && onReact && (
                <div className="col-span-3 border-t border-border/50 pt-3 mt-1">
                  <p className="text-sm font-medium text-foreground mb-2">リアクションを選択</p>
                  <div className="grid grid-cols-8 gap-2">
                    {["👍", "❤️", "😂", "🎉", "🔥", "👀", "💯", "✅", "😊", "😄", "🤔", "😮", "😢", "🥳", "👏", "🙌", "🤝", "💪", "🙏", "⭐", "💡", "🚀", "⚡", "🎯"].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => { setShowActions(false); setMobileEmojiOpen(false); onReact(message.id, emoji); }}
                        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.06] text-xl transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* ブックマーク（モバイル） */}
              {onBookmark && (
                <button
                  onClick={() => { setShowActions(false); onBookmark(message.id); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${isBookmarked ? "border-accent/40" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${isBookmarked ? "text-accent" : "text-foreground"}`} fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </span>
                  <span className={`text-xs ${isBookmarked ? "text-accent" : "text-foreground"}`}>保存</span>
                </button>
              )}
              {/* 編集 */}
              {isOwn && (
                <button
                  onClick={() => { setShowActions(false); setIsEditing(true); setEditContent(message.content); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">編集</span>
                </button>
              )}
              {/* 削除 */}
              {isOwn && (
                <button
                  onClick={() => { setShowActions(false); setIsDeleting(true); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-mention/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-mention" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </span>
                  <span className="text-xs text-mention">削除</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}


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

      {/* 画像ライトボックス（アプリ内フルスクリーン表示） */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          {/* 閉じるボタン */}
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* 画像 — ピンチズーム可能に */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="拡大画像"
            className="max-w-full max-h-full object-contain rounded-lg select-none"
            style={{ touchAction: "pinch-zoom" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});
