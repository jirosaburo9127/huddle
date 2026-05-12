-- get_channel_with_messages 内で last_read_at を NOW() に更新し、
-- 更新後の値も返す。ChannelView マウント時の別 RPC 呼び出しを不要にする。
DROP FUNCTION IF EXISTS public.get_channel_with_messages(text, text, uuid);
CREATE OR REPLACE FUNCTION public.get_channel_with_messages(p_workspace_slug text, p_channel_slug text, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_workspace_id UUID;
  v_channel_id UUID;
  v_channel JSON;
  v_messages JSON;
  v_is_member BOOLEAN;
  v_previous_last_read_at TIMESTAMPTZ;
  v_marked_read_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(c.*) INTO v_channel FROM channels c
    WHERE c.workspace_id = v_workspace_id AND c.slug = p_channel_slug;
  IF v_channel IS NULL THEN RETURN NULL; END IF;

  v_channel_id := (v_channel->>'id')::UUID;

  SELECT EXISTS(
    SELECT 1 FROM channel_members
    WHERE channel_id = v_channel_id AND user_id = p_user_id
  ) INTO v_is_member;

  IF NOT v_is_member AND NOT (v_channel->>'is_private')::BOOLEAN THEN
    INSERT INTO channel_members (channel_id, user_id)
      VALUES (v_channel_id, p_user_id)
      ON CONFLICT DO NOTHING;
  END IF;

  -- last_read_at を更新する前の値を先取り（未読区切り線の基準に使う）
  SELECT COALESCE(cm.last_read_at, cm.joined_at)
  INTO v_previous_last_read_at
  FROM channel_members cm
  WHERE cm.channel_id = v_channel_id AND cm.user_id = p_user_id;

  -- last_read_at を NOW() に更新（既読化）し、更新後の値を取得
  UPDATE channel_members
  SET last_read_at = NOW()
  WHERE channel_id = v_channel_id AND user_id = p_user_id
  RETURNING last_read_at INTO v_marked_read_at;

  SELECT json_agg(t ORDER BY t.created_at ASC) INTO v_messages FROM (
    SELECT m.*, row_to_json(p.*) as profiles,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', r.id, 'message_id', r.message_id, 'user_id', r.user_id,
          'emoji', r.emoji, 'created_at', r.created_at,
          'display_name', rp.display_name
        ))
        FROM reactions r
        JOIN profiles rp ON rp.id = r.user_id
        WHERE r.message_id = m.id
      ), '[]'::json) as reactions
    FROM messages m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.channel_id = v_channel_id
      AND m.parent_id IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'channel', v_channel,
    'messages', COALESCE(v_messages, '[]'::json),
    'previous_last_read_at', v_previous_last_read_at,
    'marked_read_at', v_marked_read_at
  );
END;
$$;
