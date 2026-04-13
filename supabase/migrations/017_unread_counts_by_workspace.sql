-- ワークスペース単位の未読集計を返す RPC
-- サイドバーのワークスペース切替ドロップダウンで、別WSに新着があるか
-- 一目でわかるようにするため。ミュート中チャンネルは除外する。

CREATE OR REPLACE FUNCTION get_unread_counts_by_workspace(p_user_id UUID)
RETURNS TABLE(workspace_id UUID, unread_count BIGINT) AS $$
  SELECT c.workspace_id, COUNT(m.id) as unread_count
  FROM channel_members cm
  JOIN channels c ON c.id = cm.channel_id
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
    AND cm.muted = FALSE
  GROUP BY c.workspace_id
  HAVING COUNT(m.id) > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_unread_counts_by_workspace(UUID) TO authenticated;
