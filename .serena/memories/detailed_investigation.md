# Huddle チャットアプリ：問題調査レポート

## 問題1: リアクションが反映されない

### 根本原因

#### 原因 A: Realtime での reactions テーブル変更が検知されない
- **現象**: 他のユーザーがリアクションを追加しても画面に表示されない
- **理由**:
  1. channel-view.tsx の Realtime 購読は `messages` テーブルのみ監視
  2. reactions テーブルの INSERT/DELETE は `messages` テーブルの変更ではない
  3. Realtime L108-178 では messages テーブルの INSERT/UPDATE のみ処理
  4. reactions テーブル変更のイベントは購読されていない

#### 原因 B: Realtime での新しいメッセージに reactions がない
- **コード**: channel-view.tsx L133-136
  ```typescript
  const newMessage = {
    ...payload.new,
    profiles: profile,
  } as unknown as MessageWithProfile;
  ```
- **問題**: 
  - `reactions` フィールドが初期化されていない (undefined)
  - `payload.new` は Message 型であり reactions 情報を持たない
  - `reactions` は別テーブルであり、リアルタイムでは自動ロードされない

#### 原因 C: DB から取得したメッセージに reactions が含まれるか不明
- **問題**: RPC `get_channel_with_messages` が実装されていない
- **コード**: page.tsx L19-27
  ```typescript
  const { data, error } = await supabase.rpc("get_channel_with_messages", {...});
  const result = data as { channel: Channel; messages: MessageWithProfile[] };
  ```
- **状態**: 
  - RPC 関数が supabase/migrations/ に存在しない
  - スキーマには `002_unread_counts_rpc.sql` で RPC があるが、これは unread_counts のみ
  - `get_channel_with_messages` は未実装

### 修正が必要な箇所

1. **RPC 関数の実装**: `get_channel_with_messages` を作成
   - messages テーブルと reactions テーブルを JOIN
   - reactions を JSON aggregate で各メッセージに含める
   - profile 情報も一緒に取得

2. **Realtime reactions 監視の追加**:
   - reactions テーブルの INSERT/DELETE を監視
   - affected message_id から該当メッセージを特定
   - setMessages() で reactions を更新

3. **Realtime メッセージ INSERT での reactions 初期化**:
   - reactions: [] で初期化
   - または reactions 取得 API を呼ぶ

---

## 問題2: メッセージがリアルタイム表示されない

### 根本原因

#### 原因 A: initialMessages が空の可能性が高い
- **コード**: page.tsx L19-34
  ```typescript
  const { data, error } = await supabase.rpc("get_channel_with_messages", ...);
  if (error || !data) redirect(`/`);
  const result = data as { channel: Channel; messages: MessageWithProfile[] };
  ```
- **状態**:
  - RPC 関数が実装されていない
  - error が発生していても redirect しているはず
  - ただし、実装がないと `data` が undefined で redirect される
  - つまり initialMessages = [] の状態もあり得る

#### 原因 B: RPC 関数が存在しないか、SQL が間違っている
- **確認内容**:
  - migrations/ に `get_channel_with_messages` が見つからない
  - git log での実装履歴も見当たらない
  - page.tsx は RPC を呼んでいるが、DB には関数がない

#### 原因 C: Realtime 購読の接続エラー
- **コード**: channel-view.tsx L109-172
  ```typescript
  const subscription = supabase
    .channel(`messages:${channel.id}`)
    .on("postgres_changes", {...})
    .subscribe();
  ```
- **問題**:
  - `.subscribe()` のエラーハンドリングがない
  - Realtime 接続に失敗しても通知されない
  - 新着メッセージが来ない理由を特定できない

#### 原因 D: データ構造の不一致
- **RPC から取得**: 
  - 期待: `{id, content, user_id, profiles: {...}, reactions: [...]}`
  - 実装: RPC が存在しない

- **Realtime INSERT**: 
  - 実際: `{id, content, user_id, channel_id, parent_id, ...}`
  - reactions は含まれない
  - profile は別途 SELECT で取得

### 修正が必要な箇所

1. **RPC 関数の実装**: (問題1と同じ)

2. **初期化エラーハンドリング**:
   - page.tsx でエラーログを出力
   - ユーザーに通知

3. **Realtime エラーハンドリング**:
   - subscription のエラーイベント監視
   - Connection 状態監視

4. **Realtime reactions 同期**: (問題1と同じ)

---

## 共通の修正

### 1. RPC 関数 `get_channel_with_messages` 実装

```sql
CREATE OR REPLACE FUNCTION get_channel_with_messages(
  p_workspace_slug TEXT,
  p_channel_slug TEXT,
  p_user_id UUID
)
RETURNS TABLE(
  channel jsonb,
  messages jsonb
) AS $$
DECLARE
  v_channel_id UUID;
BEGIN
  -- チャンネルIDを取得
  SELECT id INTO v_channel_id
  FROM channels c
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE w.slug = p_workspace_slug AND c.slug = p_channel_slug;
  
  IF v_channel_id IS NULL THEN
    RETURN;
  END IF;
  
  -- チャンネルを返す
  RETURN QUERY
  SELECT
    row_to_json(c.*),
    jsonb_agg(jsonb_build_object(
      'id', m.id,
      'channel_id', m.channel_id,
      'user_id', m.user_id,
      'parent_id', m.parent_id,
      'content', m.content,
      'edited_at', m.edited_at,
      'deleted_at', m.deleted_at,
      'is_decision', m.is_decision,
      'reply_count', m.reply_count,
      'created_at', m.created_at,
      'profiles', row_to_json(p.*),
      'reactions', COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'id', r.id,
          'emoji', r.emoji,
          'user_id', r.user_id,
          'created_at', r.created_at
        )) FILTER (WHERE r.id IS NOT NULL),
        '[]'::jsonb
      )
    ) ORDER BY m.created_at ASC)
  FROM channels c
  JOIN messages m ON m.channel_id = c.id AND m.parent_id IS NULL
  JOIN profiles p ON p.id = m.user_id
  LEFT JOIN reactions r ON r.message_id = m.id
  WHERE c.id = v_channel_id
  GROUP BY c.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 2. Realtime reactions 監視追加

channel-view.tsx に reactions テーブル監視を追加

### 3. エラーハンドリング強化

- page.tsx: RPC エラーをキャッチ
- channel-view.tsx: Realtime エラー監視
