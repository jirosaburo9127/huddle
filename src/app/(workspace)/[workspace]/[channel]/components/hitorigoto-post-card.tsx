"use client";

import { memo, useState, useRef, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import type { MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { PollDisplay } from "./poll-display";
import { ImageLightbox } from "@/components/image-lightbox";
import { extractDisplayFileName } from "@/lib/file-name";
import { useReactorNames } from "@/lib/use-reactor-names";
import { EMOJI_LIST, EmojiPicker } from "./emoji-picker";

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
  replyCount?: number;
  onOpenThread?: () => void;
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
  // @メンション
  html = html.replace(
    /(^|[\s>])@([\w.\-\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u00A0()（）]{1,30})(?=[\s<]|$)/g,
    (_m, before: string, name: string) => {
      const displayName = name === "channel" ? "All" : name.replace(/\u00A0/g, " ");
      return `${before}<span class="text-accent font-semibold">@${displayName}</span><br/>`;
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

// PC ホバー時に出る3つの即時リアクション
const QUICK_HOVER_EMOJIS = ["👍", "❤️", "🎉"];

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
  replyCount = 0,
  onOpenThread,
}: Props) {
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reacterModal, setReacterModal] = useState<{ emoji: string; names: string[]; reacted: boolean } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 画像ライトボックスの上部に表示するチャンネル名 (pathname から slug を抜く)
  const pathname = usePathname();
  const channelSlug = pathname?.split("/")[2] ?? null;
  // PCとモバイルでピッカーの実装を分ける（PC版の EmojiPicker の外側クリック検知が
  // モバイルモーダル内のタップと競合するため、モバイルでは PC版を一切マウントしない）
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(typeof window !== "undefined" && window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 削除済みは非表示
  if (message.deleted_at) return null;

  const profile = message.profiles;
  const avatarUrl = profile?.avatar_url;
  const displayName = profile?.display_name || "不明";
  const { textLines, fileUrls } = splitContentAndFiles(message.content);
  const textContent = textLines.join("\n").trim();
  const reactions = message.reactions || [];
  const grouped = groupReactions(reactions);

  // リアクションしたユーザーの display_name を user_id から解決
  const reactionUserIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of reactions) set.add(r.user_id);
    return Array.from(set);
  }, [reactions]);
  const reactorNames = useReactorNames(reactionUserIds);

  return (
    <>
      <article
        id={`msg-${message.id}`}
        className="rounded-2xl border border-border bg-surface p-4 mb-3 transition-colors"
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
            {onReact && QUICK_HOVER_EMOJIS.map((e) => (
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
                <img key={i} src={url} alt="" className="rounded-xl max-w-full max-h-80 object-cover cursor-pointer" loading="lazy" onClick={(e) => { e.stopPropagation(); setLightboxUrl(url); }} />
              ) : isVideoFile(url) ? (
                <button
                  key={i}
                  type="button"
                  className="max-w-full sm:max-w-sm rounded-2xl bg-gradient-to-br from-black/70 to-black/90 border border-white/10 flex items-center gap-4 py-4 px-5 w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const webkit = (window as any).webkit;
                    if (webkit?.messageHandlers?.playVideo) {
                      webkit.messageHandlers.playVideo.postMessage(url);
                    } else {
                      window.open(url, "_blank");
                    }
                  }}
                >
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                  <div className="text-left min-w-0">
                    <div className="text-sm font-medium text-white">動画を再生</div>
                    <div className="text-xs text-white/50 truncate">{url.split("/").pop()}</div>
                  </div>
                </button>
              ) : (
                <a
                  key={i}
                  href={url}
                  download={extractDisplayFileName(url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const { Capacitor } = await import("@capacitor/core");
                      if (Capacitor.isNativePlatform()) return;
                      e.preventDefault();
                      const fileName = extractDisplayFileName(url);
                      const res = await fetch(url);
                      const blob = await res.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = blobUrl;
                      a.download = fileName;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(blobUrl);
                    } catch {
                      // 失敗時は標準のリンク動作にフォールバック
                    }
                  }}
                  className="text-sm text-accent underline break-all block"
                >
                  {extractDisplayFileName(url)}
                </a>
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
        <div className="flex items-center gap-2 mt-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {/* リアクション */}
          {grouped.map((g) => (
            <button
              key={g.emoji}
              onClick={() => {
                if (typeof window !== "undefined" && window.innerWidth >= 1024) {
                  onReact?.(message.id, g.emoji);
                } else {
                  const resolved = g.userIds
                    .map((uid) => reactorNames[uid] || "")
                    .filter(Boolean);
                  setReacterModal({ emoji: g.emoji, names: resolved, reacted: g.userIds.includes(currentUserId) });
                }
              }}
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

          {/* +リアクション（PC・モバイル両方） */}
          {onReact && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowEmojiPicker((v) => !v); }}
                className="inline-flex items-center px-2 py-1 rounded-full text-xs border border-border text-muted hover:text-foreground transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {/* PC: 上方向ドロップダウン（モバイルでは一切マウントしない） */}
              {showEmojiPicker && isDesktop && (
                <EmojiPicker
                  onSelect={(em) => { setShowEmojiPicker(false); onReact(message.id, em); }}
                  onClose={() => setShowEmojiPicker(false)}
                  position="above"
                />
              )}
            </div>
          )}

          {/* 既読 */}
          {readCount >= 0 && (
            <span className="text-[11px] text-muted">
              {readCount === 0 ? "" : readCount === memberCount ? "既読" : `既読 ${readCount}`}
            </span>
          )}

          {/* 返信数 */}
          {replyCount > 0 && (
            <button onClick={(e) => { e.stopPropagation(); onOpenThread?.(); }} className="text-xs text-accent hover:underline">
              {replyCount}件の返信
            </button>
          )}

          {/* アクションボタン */}
          <div className="flex items-center gap-1 ml-auto" onClick={(e) => e.stopPropagation()}>
            {onReply && (
              <button
                onClick={() => onReply(message)}
                className="p-1.5 rounded-lg text-muted hover:text-foreground transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
            )}
            {onBookmark && (
              <button
                onClick={() => onBookmark(message.id)}
                className={`p-1.5 rounded-lg transition-colors ${isBookmarked ? "text-accent" : "text-muted hover:text-foreground"}`}
              >
                <svg className="w-4 h-4" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}
            {message.user_id === currentUserId && onDelete && (
              <button
                onClick={() => { if (confirm("削除しますか？")) onDelete(message.id); }}
                className="p-1.5 rounded-lg text-muted hover:text-red-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </article>

      {lightboxUrl && (
        <ImageLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
          authorName={displayName}
          authorAvatar={avatarUrl}
          timestamp={message.created_at}
          contextLabel={channelSlug ? `#${channelSlug}` : undefined}
        />
      )}

      {/* リアクターモーダル（LINE風下からスライド） */}
      {reacterModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end lg:hidden"
          onClick={() => setReacterModal(null)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full rounded-t-2xl bg-sidebar border-t border-border px-5 pt-4 pb-20 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-muted/30 mx-auto mb-4" />
            <div className="flex items-center gap-2 mb-3">
              {reacterModal.emoji.length <= 2 ? (
                <span className="text-2xl">{reacterModal.emoji}</span>
              ) : (
                <span className="text-sm font-semibold bg-accent/10 border border-accent/30 rounded-full px-2.5 py-0.5">{reacterModal.emoji}</span>
              )}
              <span className="text-base font-semibold text-foreground">リアクションした人</span>
            </div>
            <div className="space-y-2.5 mb-4">
              {reacterModal.names.map((name) => (
                <div key={name} className="text-sm text-foreground">{name}</div>
              ))}
            </div>
            {onReact && (
              <button
                onClick={() => { onReact(message.id, reacterModal.emoji); setReacterModal(null); }}
                className={`w-full py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                  reacterModal.reacted
                    ? "text-red-400 border-red-400/30 hover:bg-red-400/10"
                    : "text-accent border-accent/30 hover:bg-accent/10"
                }`}
              >
                {reacterModal.reacted ? "取り消す" : "追加する"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* モバイル絵文字ピッカー（通常チャンネルと同じ種類を表示） */}
      {showEmojiPicker && !isDesktop && (
        <div className="fixed inset-0 z-[60] flex items-end" onClick={() => setShowEmojiPicker(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-full rounded-t-2xl bg-sidebar border-t border-border shadow-xl p-4 pb-20 max-h-[75vh] overflow-y-auto">
              {EMOJI_LIST.map((group) => (
                <div key={group.category} className="mb-3">
                  <p className="text-[11px] text-muted font-medium mb-1.5">{group.category}</p>
                  {group.category === "テキスト" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEmojiPicker(false);
                            onReact?.(message.id, emoji);
                          }}
                          style={{ touchAction: "manipulation" }}
                          className="px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-sm font-medium text-foreground transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-8 gap-1.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEmojiPicker(false);
                            onReact?.(message.id, emoji);
                          }}
                          style={{ touchAction: "manipulation" }}
                          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.06] text-xl transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </>
  );
}

export const HitorigotoPostCard = memo(HitorigotoPostCardInner);
