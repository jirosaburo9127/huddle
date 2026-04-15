-- 自分の投稿は自分の未読にカウントしない
--
-- 002_unread_counts_rpc.sql で作った get_unread_counts は
-- 自分が投稿したメッセージも未読に含めてしまっていた。
-- (017_unread_counts_by_workspace.sql のワークスペース集計は正しく除外済み)
--
-- 自分が投稿 → 別チャンネル遷移 → 戻る まで自分にバッジが表示される
-- 不自然な挙動だったので、ここで除外する。

CREATE OR REPLACE FUNCTION get_unread_counts(p_user_id UUID)
RETURNS TABLE(channel_id UUID, unread_count BIGINT) AS $$
  SELECT cm.channel_id, COUNT(m.id) as unread_count
  FROM channel_members cm
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY cm.channel_id
  HAVING COUNT(m.id) > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
