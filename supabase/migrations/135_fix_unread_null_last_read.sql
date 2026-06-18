-- 未読バッジ: last_read_at が NULL の場合 joined_at をフォールバック
-- NULL > timestamp は常に FALSE なので未読が検出されない問題を修正

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
RETURNS TABLE(channel_id uuid, unread_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  SELECT cm.channel_id, COUNT(m.id)
  FROM channel_members cm
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY cm.channel_id
  HAVING COUNT(m.id) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_unread_counts_by_workspace(p_user_id uuid)
RETURNS TABLE(workspace_id uuid, unread_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  SELECT c.workspace_id, COUNT(m.id)
  FROM channel_members cm
  JOIN channels c ON c.id = cm.channel_id
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY c.workspace_id
  HAVING COUNT(m.id) > 0;
END;
$$;
