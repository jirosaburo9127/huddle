# src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx (2026-05-18T14:27:43)

**種別**: ファイル全体


## 変更前 diff

```
"use client";

import { useEffect, useState, useCallback } from "react";
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

  const imageItems: MediaItem[] = items
    .filter((i) => !isVideoUrl(i.url))
    .map((i) => ({ url: i.url }));

  const handleImageClick = useCallback((url: string) => {
    const idx = imageItems.findIndex((i) => i.url === url);
    setLightbox({ items: imageItems, index: idx >= 0 ? idx : 0 });
  }, [imageItems]);

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
          mediaList={lightbox.items}
          currentIndex={lightbox.index}
          onIndexChange={(i) => setLightbox((prev) => prev ? { ...prev, index: i } : null)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

```


## Codex レビュー

- [優先度: 今すぐ] `fetch()` 内で `cancelled` 時も `setLoading(false)` が走ります。アンマウント後の state 更新になり得るので、`if (!cancelled) setLoading(false);` にしてください。`data` が空配列でも loading は落とす必要があります。

- [優先度: 今すぐ] `currentUserId` が未使用です。権限や表示制御に使わないなら `Props` から削除してください。使う想定なら「追加」ボタン表示や操作可否に反映してください。

- [優先度: 後で] `imageItems` が毎 render で新しい配列になり、`handleImageClick` も毎回再生成されます。件数が増えると無駄が出るので `useMemo` で `imageItems` をメモ化してください。

- [優先度: 後で] 動画アイテムも `<button>` ですがクリックしても何も起きません。アクセシビリティ上も紛らわしいため、動画は `disabled` にする、`type="button"` を明示する、または動画再生/lightbox 対応を追加してください。

- [優先度: 任意] `isVideoUrl()` は拡張子判定のみなので、署名付きURLや拡張子なしURLでは誤判定します。`AlbumItem` に media type があるならそれを使い、なければ保存時に `type` を持たせる設計に寄せると安定します。


## 影響分析 (Claude read-only)

- **何が変わるか**: アルバム詳細画面で、写真の読み込み中表示が消えないことがある不具合を直し、使われていない情報の受け渡しを整理します。動画サムネイルを押しても何も起きない紛らわしい挙動も改善します。表示される写真や動画の中身は変わりません。
- **影響範囲**: この画面 (AlbumDetailModal) はアルバム一覧ページ (albums/page.tsx) からのみ呼び出されています。grep の結果、isVideoUrl はこのファイル内だけの内部関数で外部参照ゼロでした。一方 currentUserId は page.tsx 170行目で実際に渡されており、これを削除する場合は page.tsx 側も同時に直す必要があります。CreateAlbumModal など他モーダルの currentUserId は別物で影響しません。
- **LEVEL**: 注意
- **根拠**: currentUserId を Props から外すと、それを渡している albums/page.tsx も合わせて修正が必要なため。


## Claude Code 修正 (応答)

修正完了です。

**採用しなかった指摘:**
- **#2 currentUserId 未使用**: 「追加」ボタンの権限制御に使う想定がありうるため、削除/利用の判断は Author 確認が必要。インターフェース変更（呼び出し側にも影響）はスコープ外とした。
- **#5 isVideoUrl の拡張子判定**: media type をスキーマに持たせる設計変更で、本タスクの範囲外。Author 判断に委ねる。

**変更内容（3行以内）:**
1. fetch 内を `if (cancelled) return;` 構造に変更し、アンマウント後の `setLoading` を防止。
2. `imageItems` を `useMemo` でメモ化（`handleImageClick` の再生成も抑制）。
3. グリッドの `<button>` に `type="button"` 明示、動画は `disabled` 化。


## 修正後 diff (vs HEAD)

```
diff --git a/src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx b/src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx
index 8504c69..cf88a37 100644
--- a/src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx
+++ b/src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx
@@ -1,6 +1,6 @@
 "use client";
 
-import { useEffect, useState, useCallback } from "react";
+import { useEffect, useState, useCallback, useMemo } from "react";
 import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
 import { createClient } from "@/lib/supabase/client";
 import type { AlbumItem, AlbumSummary } from "@/lib/supabase/types";
@@ -32,7 +32,8 @@ export function AlbumDetailModal({ album, currentUserId, onClose, onAddItems }:
         .select("*")
         .eq("album_id", album.id)
         .order("created_at", { ascending: true });
-      if (!cancelled && data) {
+      if (cancelled) return;
+      if (data) {
         setItems(data as AlbumItem[]);
       }
       setLoading(false);
@@ -63,9 +64,10 @@ export function AlbumDetailModal({ album, currentUserId, onClose, onAddItems }:
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [album.id]);
 
-  const imageItems: MediaItem[] = items
-    .filter((i) => !isVideoUrl(i.url))
-    .map((i) => ({ url: i.url }));
+  const imageItems: MediaItem[] = useMemo(
+    () => items.filter((i) => !isVideoUrl(i.url)).map((i) => ({ url: i.url })),
+    [items]
+  );
 
   const handleImageClick = useCallback((url: string) => {
     const idx = imageItems.findIndex((i) => i.url === url);
@@ -118,7 +120,9 @@ export function AlbumDetailModal({ album, currentUserId, onClose, onAddItems }:
                 return (
                   <button
                     key={item.id}
-                    onClick={() => isVideo ? undefined : handleImageClick(item.url)}
+                    type="button"
+                    disabled={isVideo}
+                    onClick={() => handleImageClick(item.url)}
                     className="aspect-square overflow-hidden bg-border/20 relative group"
                   >
                     {isVideo ? (

```


## ステータス

✅ 修正適用完了
