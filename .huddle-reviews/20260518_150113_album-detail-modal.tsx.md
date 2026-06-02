# src/app/(workspace)/[workspace]/albums/components/album-detail-modal.tsx (2026-05-18T15:04:00)

**種別**: Git diff (vs HEAD)


## 変更前 diff

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


## Codex レビュー

- [優先度: 今すぐ] `album-detail-modal.tsx` の動画アイテムで `<button disabled>` にしている点は修正してください。動画側に `<video controls>` がある場合、無効化された `button` 配下では操作できない/HTML的にも不適切になりやすいです。動画は `button` ではなく `div` など非インタラクティブ要素で描画し、画像だけ `button type="button" onClick={...}` に分岐してください。

- [優先度: 後で] 上記の分岐に対して、動画アイテムがクリック対象にならず、画像アイテムだけライトボックスを開くことを確認するテストを追加してください。特に「動画の controls が操作不能にならない」観点を入れると再発防止になります。


## 影響分析 (Claude read-only)

- **何が変わるか**: アルバムの写真をクリックすると拡大表示される処理を安定化し、無駄な再計算をなくして表示を軽くします。動画サムネイルは誤って拡大表示が開かないようにクリック対象から外します（ただしレビュー指摘どおり、動画は無効化ボタンではなく非ボタン要素で描画する修正が別途必要です）。
- **影響範囲**: grep で `AlbumDetailModal` を検索した結果、利用箇所はアルバム一覧ページ（albums/page.tsx の172行目）1か所のみで、渡している項目（album/onClose等）は今回変更していません。`isVideoUrl`・`handleImageClick`・`imageItems` はこのファイル内だけで定義・使用されており、別画面のメディア一覧（channel-media-view.tsx）は同名でも独立した別の関数なので影響しません。
- **LEVEL**: 軽微
- **根拠**: 変更箇所はすべて AlbumDetailModal コンポーネント内に閉じており、外部 export や共通ユーティリティの変更がないため。


## ステータス

ユーザーが『スキップ』選択
