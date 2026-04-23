-- 投稿検索RPC
-- ユーザーが参加しているチャンネルのメッセージを全文検索
CREATE OR REPLACE FUNCTION public.search_messages(
  p_user_id UUID,
  p_workspace_id UUID,
  p_query TEXT,
  p_limit INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COALESCE(json_agg(row ORDER BY row.created_at DESC), '[]'::json)
  INTO v_result
  FROM (
    SELECT
      m.id,
      m.content,
      m.created_at,
      m.channel_id,
      ch.name AS channel_name,
      ch.slug AS channel_slug,
      p.display_name AS sender_name,
      p.avatar_url AS sender_avatar
    FROM public.messages m
    JOIN public.channels ch ON ch.id = m.channel_id
    JOIN public.profiles p ON p.id = m.user_id
    WHERE ch.workspace_id = p_workspace_id
      AND m.deleted_at IS NULL
      AND m.content ILIKE '%' || p_query || '%'
      AND EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.channel_id = m.channel_id AND cm.user_id = p_user_id
      )
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) row;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_messages(UUID, UUID, TEXT, INT) TO authenticated;
