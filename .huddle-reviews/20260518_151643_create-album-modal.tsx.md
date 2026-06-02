# src/app/(workspace)/[workspace]/albums/components/create-album-modal.tsx (2026-05-18T15:16:47)

**種別**: Git diff (vs HEAD)


## 変更前 diff

```
diff --git a/src/app/(workspace)/[workspace]/albums/components/create-album-modal.tsx b/src/app/(workspace)/[workspace]/albums/components/create-album-modal.tsx
index f431fbb..0d09221 100644
--- a/src/app/(workspace)/[workspace]/albums/components/create-album-modal.tsx
+++ b/src/app/(workspace)/[workspace]/albums/components/create-album-modal.tsx
@@ -152,6 +152,35 @@ export function CreateAlbumModal({ workspaceId, currentUserId, channels, addToAl
       }
     }
 
+    // チャンネルにアルバム更新通知メッセージを投稿
+    // system_eventにアルバム情報をJSON埋め込み → message-itemで専用カード表示
+    const albumTitle = addToAlbumId ? undefined : title.trim();
+    const { data: coverItem } = await supabase
+      .from("album_items")
+      .select("url")
+      .eq("album_id", albumId)
+      .order("created_at", { ascending: true })
+      .limit(1)
+      .maybeSingle();
+
+    const eventData = JSON.stringify({
+      type: "album_update",
+      album_id: albumId,
+      title: albumTitle,
+      cover_url: coverItem?.url || null,
+      item_count: files.length,
+      is_new: !addToAlbumId,
+    });
+
+    await supabase.from("messages").insert({
+      channel_id: channelId,
+      user_id: currentUserId,
+      content: addToAlbumId
+        ? `📸 アルバムに${files.length}枚追加しました`
+        : `📸 アルバム「${title.trim()}」を作成しました（${files.length}枚）`,
+      system_event: eventData,
+    });
+
     setUploading(false);
     onCreated();
     onClose();

```


## Codex レビュー

- [優先度: 今すぐ] `messages.insert` の `error` を無視しています。通知投稿に失敗してもモーダルが閉じるため、意図せず「アルバムは作成されたがチャンネルに出ない」状態になります。`const { error } = await ...insert(...)` で受け、失敗時は `throw` するか、通知は非必須なら `console.error` 等で明示的に非ブロッキング扱いにしてください。

- [優先度: 今すぐ] `item_count: files.length` は既存アルバムへの追加時に「アルバム総数」ではなく「今回追加した枚数」になります。`message-item` 側でアルバムカードに総数として表示するなら、`album_items` の `count` を取得して渡すべきです。今回追加数を出したいなら `added_count` のようにフィールド名を分けてください。

- [優先度: 後で] `system_event` に `JSON.stringify(...)` を入れていますが、カラムが `json/jsonb` ならオブジェクトをそのまま渡す方が型の一貫性が高いです。`system_event: eventData` ではなく `system_event: { type: ..., ... }` にできるか確認し、表示側のパース処理と揃えてください。


## 影響分析 (Claude read-only)

- **何が変わるか**: アルバムを作成したり写真を追加したとき、そのチャンネルのチャットに「📸 アルバムを作成しました」というサムネ付きのお知らせカードが自動で流れるようになります。今までは作っても誰にも気づかれませんでしたが、メンバーがチャットを見れば一目で分かるようになります。レビュアー指摘の通り、通知の投稿に失敗しても黙って閉じてしまう点と、写真追加時の枚数が「総数」ではなく「今回追加分」になっている点は要修正です。
- **影響範囲**: 変更は create-album-modal.tsx 内の写真アップロード処理（同一コンポーネント内のクロージャ）だけで、関数や export の形は変えていません。grep の結果、このモーダルを使うのは channel-albums.tsx と albums/page.tsx の2か所ですが、呼び出し方は変わらないため動作に影響しません。生成されるお知らせカードの表示は message-item.tsx が既に対応済みで（619〜621行で `album_update` を JSON 解析し title/cover_url/item_count/is_new を読む実装あり）、今回送るデータ形式と一致しているため壊れません。system_event カラムは types.ts 上 string 型で、表示側も文字列を JSON.parse しているので、JSON.stringify する現状の書き方は表示側と整合しています（指摘3は現状維持で問題なし）。
- **LEVEL**: 軽微
- **根拠**: 変更箇所はモーダル内部のアップロード処理のみで、外部から呼ばれる関数・exportの変更はなく、表示側(message-item)は既に同形式に対応済み。


## ステータス

ユーザーが『スキップ』選択
