# 問題2: メッセージがリアルタイム表示されない

## 現在のコード流れ

### page.tsx (Server Component)
- RPC `get_channel_with_messages` 呼び出し
- 返ってくるメッセージを initialMessages として ChannelView に渡す
- **問題: RPC 関数が見つからない（未実装？）**

### channel-view.tsx の Realtime購読 (L108-178)
```
subscription:
  - table: "messages"
  - event: "INSERT"
  - filter: `channel_id=eq.${channel.id}`
  
INSERT イベント処理 (L119-151):
  1. parent_id がある場合スキップ（スレッド返信）
  2. currentUserId のメッセージはスキップ（楽観的更新済み）
  3. profile を SELECT で取得
  4. newMessage 構築: {...payload.new, profiles: profile}
  5. setMessages() で追加

UPDATE イベント処理 (L153-171):
  1. content, edited_at, deleted_at, is_decision, reply_count 更新
  2. reactions は更新されない（別テーブル）
```

## 疑いの点

1. **初期メッセージ取得の失敗**
   - RPC `get_channel_with_messages` が実装されていない
   - 呼び出しが error を返す可能性
   - initialMessages = [] で画面に何も表示されない

2. **Realtime購読の接続失敗**
   - subscriptions.subscribe() で エラーが happen している可能性
   - エラーハンドリングがない
   - subscribe() の戻り値を確認していない

3. **データ構造の不一致**
   - RPC で返すメッセージ: {id, content, profiles: {...}, reactions: [...]}
   - Realtime INSERT: {id, content, user_id, channel_id, ...} (reactions なし)
   - profile も別途取得が必要
   - 型 MessageWithProfile との齟齬

4. **reactions が含まれない**
   - channel-view.tsx L138 で `const newMessage = {...payload.new, profiles: profile}`
   - reactions: undefined で初期化
   - つまり、Realtime で受け取ったメッセージには reactions がない
