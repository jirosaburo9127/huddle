# 問題1: リアクションが反映されない

## 現在のコード流れ

### channel-view.tsx の handleReact (L239-290)
```
handleReact(messageId, emoji)
  1. existingReaction 確認 (reactions?.find(...))
  2. ない場合: optimisticReaction 作成 → setMessages() で UI更新
  3. DB INSERT → reactions テーブルに挿入
  4. 返ってきたデータの ID で optimisticReaction.id を置き換え
```

### message-item.tsx の groupedReactions (L181-194)
```
useMemo:
  1. message.reactions || [] を取得
  2. emoji ごとにグループ化
  3. reacted フラグ設定 (reacted: list.some(r => r.user_id === currentUserId))
  4. バッジ表示 (L367-385)
```

### リアクション表示ロジック (message-item.tsx L366-385)
- groupedReactions.length > 0 で条件判定
- 各バッジをボタンとしてレンダリング
- クリックで再度 onReact を呼び出し

## 疑いの点

1. **initialMessages の reactions データ構造**
   - RPC `get_channel_with_messages` が reactions を含める必要がある
   - しかし RPC 関数実装が見つからない
   - page.tsx L27 で `MessageWithProfile[]` として型定義

2. **Realtime更新で reactions が含まれない**
   - channel-view.tsx L119-151 で INSERT イベント取得
   - payload.new には reactions が含まれない (Message 型だから)
   - reactions は別テーブルなので別途取得が必要
   - 現在は profile のみ取得

3. **UPDATE イベント対応不足**
   - reactions テーブルの INSERT/DELETE は reactions テーブルの変更
   - messages テーブルの UPDATE ではない
   - Realtime購読は messages テーブルのみ監視
   - reactions テーブルの変更は captured されない
