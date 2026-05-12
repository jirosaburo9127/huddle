-- get_my_replies に is_hitorigoto 列を追加
-- 独り言チャンネルでは返信(parent_id付き)がDOMに出ないため、
-- フロント側で親投稿にフォールバックする判定に使う
DROP FUNCTION IF EXISTS public.get_my_replies(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_my_replies(p_user_id uuid, p_workspace_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(reply_id uuid, replied_at timestamptz, replier_id uuid, replier_name text, replier_avatar text, reply_content text, parent_message_id uuid, parent_content text, channel_id uuid, channel_name text, channel_slug text, is_new boolean, is_hitorigoto boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  SELECT
    reply.id, reply.created_at, reply.user_id,
    rp.display_name, rp.avatar_url, reply.content,
    parent.id, parent.content,
    c.id, c.name, c.slug,
    (reply.created_at > COALESCE(self.reply_seen_at, '1970-01-01'::timestamptz)),
    COALESCE(c.is_hitorigoto, false)
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
END;
$$;
