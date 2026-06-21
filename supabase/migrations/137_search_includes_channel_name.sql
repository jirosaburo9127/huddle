-- 検索でチャンネル名もヒットするように拡張
CREATE OR REPLACE FUNCTION public.search_messages(p_user_id uuid, p_workspace_id uuid, p_query text, p_limit integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT COALESCE(json_agg(row ORDER BY row.created_at DESC), '[]'::json)
  INTO v_result
  FROM (
    SELECT
      m.id, m.content, m.created_at, m.channel_id,
      ch.name AS channel_name, ch.slug AS channel_slug,
      p.display_name AS sender_name, p.avatar_url AS sender_avatar
    FROM public.messages m
    JOIN public.channels ch ON ch.id = m.channel_id
    JOIN public.profiles p ON p.id = m.user_id
    WHERE ch.workspace_id = p_workspace_id
      AND m.deleted_at IS NULL
      AND (
        m.content ILIKE '%' || p_query || '%'
        OR ch.name ILIKE '%' || p_query || '%'
      )
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
