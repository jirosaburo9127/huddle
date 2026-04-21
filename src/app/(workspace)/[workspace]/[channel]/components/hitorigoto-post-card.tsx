"use client";

import { memo, useState, useRef, useEffect } from "react";
import type { MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { PollDisplay } from "./poll-display";

type Props = {
  message: MessageWithProfile;
  parentMessage?: MessageWithProfile | null;
  currentUserId: string;
  onReply?: (message: MessageWithProfile) => void;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
  onBookmark?: (messageId: string) => Promise<void>;
  isBookmarked?: boolean;
  hasPoll?: boolean;
  readCount?: number;
  memberCount?: number;
};

// Supabase Storage URL判定
function isStorageFileUrl(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.includes("\n")) return false;
  return /^https:\/\/.*supabase.*\/storage\/v1\/object\/public\/chat-files\//.test(trimmed);
}

function isImageFile(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url);
}

function isVideoFile(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) =>
    `<pre class="bg-white/[0.06] rounded-lg p-3 my-1 overflow-x-auto"><code class="text-sm font-mono">${code.trim()}</code></pre>`
  );
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    `<code class="bg-white/[0.06] px-1.5 py-0.5 rounded text-sm font-mono">${code}</code>`
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?:javascript|vbscript):/gi, "blocked:");
  html = html.replace(/data:(?!image\/)/gi, "blocked:");
  html = html.replace(
    /(?<!["=>])(https?:\/\/[^\s<]+)/g,
    (_m, raw: string) => {
      const trimmed = raw.replace(/[。、．，）\])\}>"'`,.!?;:]+$/u, "");
      const dropped = raw.slice(trimmed.length);
      return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" class="text-accent underline break-all">${trimmed}</a>${dropped}`;
    }
  );
  return html;
}

function splitContentAndFiles(content: string): { textLines: string[]; fileUrls: string[] } {
  const lines = content.split("\n");
  const textLines: string[] = [];
  const fileUrls: string[] = [];
  for (const line of lines) {
    if (isStorageFileUrl(line)) {
      fileUrls.push(line.trim());
    } else {
      textLines.push(line);
    }
  }
  return { textLines, fileUrls };
}

// 相対時間表示
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(dateStr).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

// リアクション集計
function groupReactions(reactions: Reaction[]) {
  const map = new Map<string, { emoji: string; count: number; users: string[]; userIds: string[] }>();
  for (const r of reactions) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count++;
      existing.users.push(r.display_name || "");
      existing.userIds.push(r.user_id);
    } else {
      map.set(r.emoji, {
        emoji: r.emoji,
        count: 1,
        users: [r.display_name || ""],
        userIds: [r.user_id],
      });
    }
  }
  return Array.from(map.values());
}

const QUICK_EMOJIS = ["👍", "❤️", "😊", "🎉", "👀", "🙏"];
const TEXT_REACTIONS = ["完了しました！", "了解！", "確認中", "対応します", "ありがとう！", "お疲れ様！"];

function HitorigotoPostCardInner({
  message,
  parentMessage,
  currentUserId,
  onReply,
  onReact,
  onDelete,
  onBookmark,
  isBookmarked,
  hasPoll,
  readCount = -1,
  memberCount = 0,
}: Props) {
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  // 削除済みは非表示
  if (message.deleted_at) return null;

  const profile = message.profiles;
  const avatarUrl = profile?.avatar_url;
  const displayName = profile?.display_name || "不明";
  const { textLines, fileUrls } = splitContentAndFiles(message.content);
  const textContent = textLines.join("\n").trim();
  const reactions = message.reactions || [];
  const grouped = groupReactions(reactions);

  // 長押しでアクションモーダル
  const handleTouchStart = () => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setShowActions(true);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  return (
    <>
      <article
        id={`msg-${message.id}`}
        className="rounded-2xl border border-border bg-surface p-4 mb-3 transition-colors"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* 返信先 */}
        {parentMessage && (
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            <span className="font-semibold shrink-0">{parentMessage.profiles?.display_name}</span>
            <span className="truncate">{parentMessage.content.replace(/\s+/g, " ").slice(0, 40)}</span>
          </div>
        )}

        {/* ヘッダー: アバター + 名前 + 時間 */}
        <div className="flex items-center gap-3 mb-2.5">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="w-10 h-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-accent">{displayName[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-sm text-foreground">{displayName}</span>
            <span className="text-xs text-muted ml-2">{relativeTime(message.created_at)}</span>
          </div>
          {/* PCアクション */}
          <div className="hidden lg:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onReact && QUICK_EMOJIS.slice(0, 3).map((e) => (
              <button key={e} onClick={() => onReact(message.id, e)} className="text-lg hover:scale-125 transition-transform">{e}</button>
            ))}
            {onReply && (
              <button onClick={() => onReply(message)} className="p-1 text-muted hover:text-foreground rounded transition-colors" title="返信">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* コンテンツ */}
        {textContent && (
          <div
            className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed mb-2"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(textContent) }}
          />
        )}

        {/* ファイル（画像・動画） */}
        {fileUrls.length > 0 && (
          <div className="space-y-2 mb-2">
            {fileUrls.map((url, i) =>
              isImageFile(url) ? (
                <img key={i} src={url} alt="" className="rounded-xl max-w-full max-h-80 object-cover" loading="lazy" />
              ) : isVideoFile(url) ? (
                <video key={i} src={url} controls className="rounded-xl max-w-full max-h-80" preload="metadata" />
              ) : (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline break-all block">{url.split("/").pop()}</a>
              )
            )}
          </div>
        )}

        {/* 投票 */}
        {hasPoll && (
          <div className="mb-2" onClick={(e) => e.stopPropagation()}>
            <PollDisplay messageId={message.id} currentUserId={currentUserId} />
          </div>
        )}

        {/* フッター: リアクション + 返信数 + 既読 */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* リアクション */}
          {grouped.map((g) => (
            <button
              key={g.emoji}
              onClick={() => onReact?.(message.id, g.emoji)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                g.userIds.includes(currentUserId)
                  ? "border-accent/40 bg-accent/10 text-foreground"
                  : "border-border bg-transparent text-muted hover:bg-white/[0.04]"
              }`}
            >
              {g.emoji.length <= 2 ? (
                <span className="text-base">{g.emoji}</span>
              ) : (
                <span className="text-xs font-medium">{g.emoji}</span>
              )}
              <span>{g.count}</span>
            </button>
          ))}

          {/* +リアクション（モバイル） */}
          {onReact && (
            <button
              onClick={() => setShowEmojiPicker(true)}
              className="lg:hidden inline-flex items-center px-2 py-1 rounded-full text-xs border border-border text-muted hover:text-foreground transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}

          {/* 既読 */}
          {readCount >= 0 && (
            <span className="text-[11px] text-muted ml-auto">
              {readCount === 0 ? "" : readCount === memberCount ? "既読" : `既読 ${readCount}`}
            </span>
          )}
        </div>
      </article>

      {/* モバイル絵文字ピッカー */}
      {showEmojiPicker && (
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden" onClick={() => setShowEmojiPicker(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-full rounded-t-2xl bg-sidebar border-t border-border shadow-xl p-4 pb-20">
              <div className="grid grid-cols-8 gap-2 mb-3">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact?.(message.id, e); setShowEmojiPicker(false); }}
                    className="text-2xl p-2 rounded-lg hover:bg-white/[0.06] active:scale-90 transition-transform"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted font-medium mb-1.5">テキスト</p>
              <div className="flex flex-wrap gap-1.5">
                {TEXT_REACTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onReact?.(message.id, t); setShowEmojiPicker(false); }}
                    className="px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-sm font-medium text-foreground transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* モバイルアクションモーダル */}
      {showActions && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center lg:hidden"
          onClick={() => setShowActions(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-sm mx-4 mb-20 rounded-2xl bg-sidebar border border-border p-5 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-3">
              {onReply && (
                <button
                  onClick={() => { setShowActions(false); onReply(message); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">返信</span>
                </button>
              )}
              {onBookmark && (
                <button
                  onClick={() => { setShowActions(false); onBookmark(message.id); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${isBookmarked ? "border-accent bg-accent/15" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${isBookmarked ? "text-accent" : "text-foreground"}`} fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">{isBookmarked ? "保存済" : "ブックマーク"}</span>
                </button>
              )}
              {message.user_id === currentUserId && onDelete && (
                <button
                  onClick={() => { setShowActions(false); onDelete(message.id); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-red-400/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </span>
                  <span className="text-xs text-red-400">削除</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const HitorigotoPostCard = memo(HitorigotoPostCardInner);
