"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ImageLightbox, type MediaItem } from "@/components/image-lightbox";

// メッセージ content に含まれる Storage URL を抽出
const FILE_URL_RE = /https:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/[^\s]+/g;

function isImageUrl(u: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|heic)(\?|#|$)/i.test(u);
}

function isVideoUrl(u: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
}

type Row = {
  message_id: string;
  content: string;
  created_at: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type Props = {
  workspaceSlug: string;
  channelSlug: string;
  channelName: string;
  rawRows: Row[];
};

type Item = MediaItem & {
  type: "image" | "video";
};

export function ChannelMediaView({ workspaceSlug, channelSlug, channelName, rawRows }: Props) {
  // メッセージ content からメディア URL を抽出してフラット化
  // 1メッセージに複数のファイルが含まれる場合は順番に展開
  const items: Item[] = useMemo(() => {
    const arr: Item[] = [];
    for (const row of rawRows) {
      const urls = row.content.match(FILE_URL_RE) || [];
      for (const url of urls) {
        if (isImageUrl(url)) {
          arr.push({
            type: "image",
            url,
            authorName: row.display_name || undefined,
            authorAvatar: row.avatar_url || undefined,
            timestamp: row.created_at,
          });
        } else if (isVideoUrl(url)) {
          arr.push({
            type: "video",
            url,
            authorName: row.display_name || undefined,
            authorAvatar: row.avatar_url || undefined,
            timestamp: row.created_at,
          });
        }
      }
    }
    return arr;
  }, [rawRows]);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー: 戻る + 「写真・動画」 */}
      <header className="flex items-center gap-2 px-3 sm:px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <Link
          href={`/${workspaceSlug}/${channelSlug}`}
          className="shrink-0 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="font-bold text-base sm:text-lg truncate min-w-0">
          写真・動画 <span className="text-muted font-normal">#{channelName}</span>
        </h1>
        <span className="ml-auto text-xs text-muted shrink-0">{items.length} 件</span>
      </header>

      {/* グリッド */}
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="text-center text-sm text-muted py-12 px-6">
            このチャンネルにはまだ写真や動画がありません
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
            {items.map((item, i) => (
              <button
                key={`${item.url}-${i}`}
                type="button"
                onClick={() => {
                  // 動画は iOS ネイティブ AVPlayer で再生（既存メッセージ内の挙動と統一）
                  // PC/Web は通常通り Lightbox で再生
                  if (item.type === "video") {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const webkit = (window as any).webkit;
                    if (webkit?.messageHandlers?.playVideo) {
                      webkit.messageHandlers.playVideo.postMessage(item.url);
                      return;
                    }
                  }
                  setActiveIndex(i);
                }}
                className="relative aspect-square overflow-hidden rounded-md bg-black/10 hover:opacity-90 transition-opacity group"
              >
                {item.type === "image" ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.url}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <>
                    {/* 動画はサムネイル代わりに video の最初のフレーム + ▶ オーバーレイ */}
                    <video
                      src={item.url}
                      preload="metadata"
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                        <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </>
                )}
                {/* 投稿者バッジ（左下） */}
                {item.authorName && (
                  <div className="absolute bottom-1 left-1 flex items-center gap-1 max-w-[calc(100%-0.5rem)]">
                    {item.authorAvatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.authorAvatar}
                        alt={item.authorName}
                        className="w-4 h-4 rounded-full object-cover ring-1 ring-black/40 shrink-0"
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-white/30 ring-1 ring-black/40 flex items-center justify-center text-[8px] font-bold text-white shrink-0">
                        {item.authorName[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-[10px] text-white font-medium truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                      {item.authorName}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ライトボックス（連続閲覧モード） */}
      {activeIndex !== null && (
        <ImageLightbox
          mediaList={items}
          currentIndex={activeIndex}
          onIndexChange={setActiveIndex}
          onClose={() => setActiveIndex(null)}
          contextLabel={`#${channelName}`}
        />
      )}
    </div>
  );
}
