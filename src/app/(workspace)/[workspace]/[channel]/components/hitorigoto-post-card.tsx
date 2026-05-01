"use client";

import { memo, useState } from "react";
import { usePathname } from "next/navigation";
import type { MessageWithProfile } from "@/lib/supabase/types";
import { PollDisplay } from "./poll-display";
import { ImageLightbox } from "@/components/image-lightbox";
import { VideoThumbnail } from "@/components/video-thumbnail";
import { extractDisplayFileName } from "@/lib/file-name";

type Props = {
  message: MessageWithProfile;
  currentUserId: string;
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

function HitorigotoPostCardInner({
  message,
  currentUserId,
  onDelete,
  onBookmark,
  isBookmarked,
  hasPoll,
  readCount = -1,
  memberCount = 0,
}: Props) {
  const [lightboxState, setLightboxState] = useState<{ urls: string[]; index: number } | null>(null);
  const pathname = usePathname();
  const channelSlug = pathname?.split("/")[2] ?? null;

  // 削除済みは非表示
  if (message.deleted_at) return null;

  const profile = message.profiles;
  const avatarUrl = profile?.avatar_url;
  const displayName = profile?.display_name || "不明";
  const { textLines, fileUrls } = splitContentAndFiles(message.content);
  const textContent = textLines.join("\n").trim();

  return (
    <>
      <article
        id={`msg-${message.id}`}
        className="rounded-2xl border border-border bg-surface p-4 mb-3 transition-colors"
      >
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
        </div>

        {/* コンテンツ */}
        {textContent && (
          <div
            className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed mb-2"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(textContent) }}
          />
        )}

        {/* ファイル（画像・動画） */}
        {fileUrls.length > 0 && (() => {
          const imageUrls = fileUrls.filter((u) => isImageFile(u));
          return (
          <div className="mb-2">
            {/* 画像: 1枚なら単独、2枚以上は X 風の横スライドカルーセル */}
            {imageUrls.length === 1 && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrls[0]}
                alt=""
                className="rounded-xl max-w-full max-h-80 object-cover cursor-pointer mb-2"
                loading="lazy"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxState({ urls: imageUrls, index: 0 });
                }}
              />
            )}
            {imageUrls.length >= 2 && (
              <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                {imageUrls.map((url, idx) => (
                  <button
                    key={url + idx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxState({ urls: imageUrls, index: idx });
                    }}
                    className="snap-start shrink-0 w-[78%] sm:w-[260px] aspect-square rounded-xl overflow-hidden bg-black/5 first:ml-1 last:mr-1 hover:opacity-90 transition-opacity"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            {/* 動画・その他のファイル（画像はすでに上で描画済みなのでスキップ） */}
            <div className="space-y-2">
            {fileUrls.map((url, i) =>
              isImageFile(url) ? null : isVideoFile(url) ? (
                <button
                  key={i}
                  type="button"
                  className="block max-w-full sm:max-w-sm rounded-2xl overflow-hidden bg-black/80 hover:opacity-95 transition-opacity w-full"
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
                  <div className="relative aspect-video bg-black">
                    <VideoThumbnail
                      url={url}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <svg className="w-7 h-7 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2 text-xs text-white/80 truncate text-left">
                    {extractDisplayFileName(url)}
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
          </div>
          );
        })()}

        {/* 投票 */}
        {hasPoll && (
          <div className="mb-2" onClick={(e) => e.stopPropagation()}>
            <PollDisplay messageId={message.id} currentUserId={currentUserId} />
          </div>
        )}

        {/* フッター: 既読 + ブックマーク + 削除 (リアクション/返信なし) */}
        <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
          {/* 既読 */}
          {readCount >= 0 && (
            <span className="text-[11px] text-muted">
              {readCount === 0 ? "" : readCount === memberCount ? "既読" : `既読 ${readCount}`}
            </span>
          )}

          <div className="flex items-center gap-1 ml-auto">
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

      {lightboxState && (
        <ImageLightbox
          mediaList={lightboxState.urls.map((u) => ({
            url: u,
            authorName: displayName,
            authorAvatar: avatarUrl,
            timestamp: message.created_at,
          }))}
          currentIndex={lightboxState.index}
          onIndexChange={(newIndex) =>
            setLightboxState((prev) => (prev ? { ...prev, index: newIndex } : null))
          }
          onClose={() => setLightboxState(null)}
          contextLabel={channelSlug ? `#${channelSlug}` : undefined}
        />
      )}
    </>
  );
}

export const HitorigotoPostCard = memo(HitorigotoPostCardInner);
