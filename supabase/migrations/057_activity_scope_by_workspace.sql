-- アクティビティをワークスペース単位にスコープ
-- 既存の get_my_activities / has_unread_activity は全 WS 横断していたため、
-- p_workspace_id を必須にして当該 WS のチャンネルに限定する。

DROP FUNCTION IF EXISTS public.get_my_activities(UUID, INT);
DROP FUNCTION IF EXISTS public.has_unread_activity(UUID);

CREATE OR REPLACE FUNCTION public.get_my_activities(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  reaction_id UUID,
  emoji TEXT,
  reacted_at TIMESTAMPTZ,
  reactor_id UUID,
  reactor_name TEXT,
  reactor_avatar TEXT,
  message_id UUID,
  message_content TEXT,
  channel_id UUID,
  channel_name TEXT,
  channel_slug TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id AS reaction_id,
    r.emoji,
    r.created_at AS reacted_at,
    r.user_id AS reactor_id,
    rp.display_name AS reactor_name,
    rp.avatar_url AS reactor_avatar,
    m.id AS message_id,
    m.content AS message_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug
  FROM public.reactions r
  JOIN public.messages m ON m.id = r.message_id
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.profiles rp ON rp.id = r.user_id
  WHERE m.user_id = p_user_id
    AND r.user_id <> p_user_id
    AND m.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_activities(UUID, UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_unread_activity(
  p_user_id UUID,
  p_workspace_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reactions r
    JOIN public.messages m ON m.id = r.message_id
    JOIN public.channels c ON c.id = m.channel_id
    JOIN public.profiles p ON p.id = p_user_id
    WHERE m.user_id = p_user_id
      AND r.user_id <> p_user_id
      AND m.deleted_at IS NULL
      AND c.workspace_id = p_workspace_id
      AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_unread_activity(UUID, UUID) TO authenticated;
