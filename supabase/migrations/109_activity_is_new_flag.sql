-- アクティビティ各行に is_new フラグを返すよう RPC を更新
-- profiles.activity_seen_at / mention_seen_at / reply_seen_at と各行のタイムスタンプを比較し、
-- 「タブを開いた時点で未読だった」項目を背景色で目立たせるためのフラグ。
-- 既存 RPC のシグネチャ変更には DROP FUNCTION → CREATE FUNCTION が必要。

DROP FUNCTION IF EXISTS public.get_my_activities(UUID, UUID, INT);
DROP FUNCTION IF EXISTS public.get_my_mentions(UUID, UUID, INT);
DROP FUNCTION IF EXISTS public.get_my_replies(UUID, UUID, INT);

-- 1) リアクション一覧 + is_new
CREATE FUNCTION public.get_my_activities(
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
  channel_slug TEXT,
  is_new BOOLEAN
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
    c.slug AS channel_slug,
    (r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)) AS is_new
  FROM public.reactions r
  JOIN public.messages m ON m.id = r.message_id
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.profiles rp ON rp.id = r.user_id
  JOIN public.profiles p ON p.id = p_user_id
  WHERE m.user_id = p_user_id
    AND r.user_id <> p_user_id
    AND m.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_activities(UUID, UUID, INT) TO authenticated;

-- 2) メンション一覧 + is_new
CREATE FUNCTION public.get_my_mentions(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  mention_id UUID,
  mentioned_at TIMESTAMPTZ,
  author_id UUID,
  author_name TEXT,
  author_avatar TEXT,
  message_id UUID,
  message_content TEXT,
  channel_id UUID,
  channel_name TEXT,
  channel_slug TEXT,
  is_new BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    mn.id AS mention_id,
    m.created_at AS mentioned_at,
    m.user_id AS author_id,
    p.display_name AS author_name,
    p.avatar_url AS author_avatar,
    m.id AS message_id,
    m.content AS message_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug,
    (m.created_at > COALESCE(self.mention_seen_at, '1970-01-01'::timestamptz)) AS is_new
  FROM public.mentions mn
  JOIN public.messages m ON m.id = mn.message_id
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.profiles p ON p.id = m.user_id
  JOIN public.profiles self ON self.id = p_user_id
  WHERE mn.mentioned_user_id = p_user_id
    AND m.user_id <> p_user_id
    AND m.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_mentions(UUID, UUID, INT) TO authenticated;

-- 3) 返信一覧 + is_new
CREATE FUNCTION public.get_my_replies(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  reply_id UUID,
  replied_at TIMESTAMPTZ,
  replier_id UUID,
  replier_name TEXT,
  replier_avatar TEXT,
  reply_content TEXT,
  parent_message_id UUID,
  parent_content TEXT,
  channel_id UUID,
  channel_name TEXT,
  channel_slug TEXT,
  is_new BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    reply.id AS reply_id,
    reply.created_at AS replied_at,
    reply.user_id AS replier_id,
    rp.display_name AS replier_name,
    rp.avatar_url AS replier_avatar,
    reply.content AS reply_content,
    parent.id AS parent_message_id,
    parent.content AS parent_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug,
    (reply.created_at > COALESCE(self.reply_seen_at, '1970-01-01'::timestamptz)) AS is_new
  FROM public.messages reply
  JOIN public.messages parent ON parent.id = reply.parent_id
  JOIN public.channels c ON c.id = reply.channel_id
  JOIN public.profiles rp ON rp.id = reply.user_id
  JOIN public.profiles self ON self.id = p_user_id
  WHERE parent.user_id = p_user_id
    AND reply.user_id <> p_user_id
    AND reply.deleted_at IS NULL
    AND parent.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY reply.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_replies(UUID, UUID, INT) TO authenticated;
