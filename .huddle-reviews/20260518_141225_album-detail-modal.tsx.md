# src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx (2026-05-18T14:12:32)

**種別**: ファイル全体


## 変更前 diff

```
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AlbumItem, AlbumSummary } from "@/lib/supabase/types";
import { ImageLightbox } from "@/components/image-lightbox";
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
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      const { data } = await supabase
        .from("album_items")
        .select("*")
        .eq("album_id", album.id)
        .order("created_at", { ascending: true });
      if (!cancelled && data) {
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
      }, (payload) => {
        const newItem = payload.new as AlbumItem;
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

  const imageUrls = items.filter((i) => !isVideoUrl(i.url)).map((i) => i.url);

  const handleImageClick = useCallback((url: string) => {
    const idx = imageUrls.indexOf(url);
    setLightbox({ urls: imageUrls, index: idx >= 0 ? idx : 0 });
  }, [imageUrls]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full sm:max-w-2xl lg:max-w-4xl sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-sidebar border border-border shadow-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">{album.title}</h2>
            <span className="text-xs text-muted">#{album.channel_name} · {items.length}枚</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onAddItems}
              className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              追加
            </button>
            <button onClick={onClose} className="p-1 text-muted hover:text-foreground transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* グリッド */}
        <div className="flex-1 overflow-y-auto p-3">
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
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
              {items.map((item) => {
                const isVideo = isVideoUrl(item.url);
                return (
                  <button
                    key={item.id}
                    onClick={() => isVideo ? undefined : handleImageClick(item.url)}
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
      </div>

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          mediaList={lightbox.urls}
          currentIndex={lightbox.index}
          onNavigate={(i) => setLightbox((prev) => prev ? { ...prev, index: i } : null)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

```


## Codex レビュー

- [優先度: 今すぐ] `useEffect` 内の `setLoading(false)` が `cancelled` 判定の外にあるため、アンマウント後や `album.id` 変更後に古い fetch が完了すると state update が走ります。`if (!cancelled) { setItems(...); setLoading(false); }` にまとめ、fetch 開始時にも `setLoading(true)` を入れてください。

- [優先度: 今すぐ] `currentUserId` が未使用で、アルバム所有者/参加者による「追加」可否制御がありません。不要なら Props から削除、必要なら `album` 側の権限情報と照合して `onAddItems` ボタン表示・実行を制御してください。

- [優先度: 後で] Realtime は `INSERT` のみ購読しているため、削除・更新が反映されず UI が古い状態になります。`DELETE` で `items` から除外、`UPDATE` で該当 item を差し替える購読を追加してください。

- [優先度: 後で] `handleImageClick` が `imageUrls` 配列に依存しており、`items` 更新のたびに配列と callback が再生成されます。`imageUrls` は `useMemo` 化し、同一 URL が複数あるケースを避けるためクリック時は `item.id` または map 時の画像インデックスから lightbox index を渡す形にしてください。

- [優先度: 任意] 動画 item も `<button>` になっていますがクリックしても何も起きません。アクセシビリティ上は `disabled` にする、または `<div>` に分岐する、もしくは動画再生/プレビューを実装してください。


## 影響分析 (Claude read-only)

- **何が変わるか**: アルバムの写真一覧画面で、画面を閉じた後に読み込みが終わると稀に表示がおかしくなる不具合を直し、写真の削除・差し替えがリアルタイムで反映されるようになります。あわせて未使用の項目を整理します。
- **影響範囲**: grep で AlbumDetailModal / album-detail-modal を全コード検索しましたが、このファイル自身以外からは一切呼び出されていません。アルバム機能自体がまだ他画面に組み込まれていない新規実装（隣の album-card.tsx も未使用）で、メッセージ・通知・サイドバー等の既存機能には影響しません。currentUserId プロップも他ファイルから渡されていないため削除しても波及しません。
- **LEVEL**: 影響なし
- **根拠**: AlbumDetailModal はまだどこからも import されておらず、機能全体が未接続のため。


## ステータス

ユーザーが『スキップ』選択
