-- 未読数を一括取得するRPC関数
CREATE OR REPLACE FUNCTION get_unread_counts(p_user_id UUID)
RETURNS TABLE(channel_id UUID, unread_count BIGINT) AS $$
  SELECT cm.channel_id, COUNT(m.id) as unread_count
  FROM channel_members cm
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
  WHERE cm.user_id = p_user_id
  GROUP BY cm.channel_id
  HAVING COUNT(m.id) > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
