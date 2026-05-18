"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { AlbumItem, AlbumSummary } from "@/lib/supabase/types";
import { ImageLightbox, type MediaItem } from "@/components/image-lightbox";
import { VideoThumbnail } from "@/components/video-thumbnail";

type Props = {
  album: AlbumSummary;
  currentUserId: string;
  onClose: () => void;
  onAddItems: () => void;
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|avi)/i.test(url.split("?")[0].split("#")[0]);
}

export function AlbumDetailModal({ album, currentUserId, onClose, onAddItems }: Props) {
  const supabase = createClient();
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      const { data } = await supabase
        .from("album_items")
        .select("*")
        .eq("album_id", album.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (data) {
        setItems(data as AlbumItem[]);
      }
      setLoading(false);
    }
    fetch();

    // Realtime購読
    const sub = supabase
      .channel(`album-items-${album.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "album_items",
        filter: `album_id=eq.${album.id}`,
      }, (payload: RealtimePostgresInsertPayload<AlbumItem>) => {
        const newItem = payload.new;
        setItems((prev) => {
          if (prev.some((i) => i.id === newItem.id)) return prev;
          return [...prev, newItem];
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id]);

  const imageItems: MediaItem[] = useMemo(
    () => items.filter((i) => !isVideoUrl(i.url)).map((i) => ({ url: i.url })),
    [items]
  );

  const handleImageClick = useCallback((url: string) => {
    const idx = imageItems.findIndex((i) => i.url === url);
    setLightbox({ items: imageItems, index: idx >= 0 ? idx : 0 });
  }, [imageItems]);

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 text-center flex-1 px-2">
            <h2 className="text-sm font-bold text-foreground truncate">{album.title}</h2>
            <span className="text-[11px] text-muted">{items.length}枚</span>
          </div>
          <button
            onClick={onAddItems}
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors shrink-0"
          >
            追加
          </button>
        </div>

        {/* グリッド（余白なし、下部にBottomTabBar分の余白） */}
        <div className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">
              <p>まだ写真がありません</p>
              <button onClick={onAddItems} className="text-accent text-xs mt-2 hover:underline">写真を追加</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-px">
              {items.map((item) => {
                const isVideo = isVideoUrl(item.url);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (isVideo) {
                        // iOS: ネイティブAVPlayer / PC: 別タブ再生
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const webkit = (window as any).webkit;
                        if (webkit?.messageHandlers?.playVideo) {
                          webkit.messageHandlers.playVideo.postMessage(item.url);
                        } else {
                          window.open(item.url, "_blank");
                        }
                      } else {
                        handleImageClick(item.url);
                      }
                    }}
                    className="aspect-square overflow-hidden bg-border/20 relative group"
                  >
                    {isVideo ? (
                      <VideoThumbnail url={item.url} className="w-full h-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                    )}
                    {isVideo && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center">
                          <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          mediaList={lightbox.items}
          currentIndex={lightbox.index}
          onIndexChange={(i) => setLightbox((prev) => prev ? { ...prev, index: i } : null)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
