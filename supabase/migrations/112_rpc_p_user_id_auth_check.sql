-- セキュリティ修正: p_user_id を引数に取る SECURITY DEFINER RPC に
-- auth.uid() との照合を追加する。これがないと他人の UID を渡すだけで
-- 他人の権限で読み取り・自動 join 等ができてしまう (外部評価で指摘)。
--
-- 共通パターン:
--   IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
--     RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
--   END IF;
--
-- auth.uid() IS NULL のケース (service role / Edge Function) は
-- バイパスする (正当なバックエンド呼び出しを壊さないため)。

-- ============================================================================
-- 1) get_workspace_data
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_workspace_data(p_workspace_slug text, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_workspace JSON;
  v_channels JSON;
  v_dm_channels JSON;
  v_members JSON;
  v_unread JSON;
  v_all_workspaces JSON;
  v_hitorigoto JSON;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(w.*) INTO v_workspace FROM workspaces w WHERE w.id = v_workspace_id;

  SELECT COALESCE(json_agg(sub ORDER BY sub.created_at ASC), '[]'::json) INTO v_channels
  FROM (
    SELECT c.*
    FROM channels c
    WHERE c.workspace_id = v_workspace_id
      AND c.is_dm = false
      AND c.is_hitorigoto = false
      AND EXISTS (
        SELECT 1 FROM channel_members cm
        WHERE cm.channel_id = c.id AND cm.user_id = p_user_id
      )
  ) sub;

  SELECT COALESCE(json_agg(row_to_json(sub2)), '[]'::json) INTO v_dm_channels
  FROM (
    SELECT c.*,
      (SELECT COALESCE(json_agg(json_build_object(
        'user_id', cm2.user_id,
        'profiles', json_build_object(
          'display_name', p2.display_name, 'avatar_url', p2.avatar_url,
          'status', p2.status, 'last_seen_at', p2.last_seen_at
        )
      )), '[]'::json) FROM channel_members cm2 JOIN profiles p2 ON p2.id = cm2.user_id WHERE cm2.channel_id = c.id
      ) as channel_members
    FROM channels c
    WHERE c.workspace_id = v_workspace_id
      AND c.is_dm = true
      AND EXISTS (
        SELECT 1 FROM channel_members cm
        WHERE cm.channel_id = c.id AND cm.user_id = p_user_id
      )
  ) sub2;

  SELECT row_to_json(hc) INTO v_hitorigoto
  FROM (
    SELECT c.id, c.slug, c.name
    FROM channels c
    WHERE c.workspace_id = v_workspace_id
      AND c.is_hitorigoto = true
    LIMIT 1
  ) hc;

  SELECT COALESCE(json_agg(json_build_object(
    'user_id', wm.user_id,
    'profiles', json_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', p.status)
  )), '[]'::json) INTO v_members
  FROM workspace_members wm JOIN profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id;

  SELECT COALESCE(json_agg(json_build_object('channel_id', sub3.channel_id, 'unread_count', sub3.cnt)), '[]'::json) INTO v_unread
  FROM (
    SELECT cm.channel_id, COUNT(m.id) as cnt
    FROM channel_members cm
    JOIN messages m ON m.channel_id = cm.channel_id
      AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
      AND m.parent_id IS NULL
      AND m.deleted_at IS NULL
      AND m.user_id <> p_user_id
    WHERE cm.user_id = p_user_id
    GROUP BY cm.channel_id HAVING COUNT(m.id) > 0
  ) sub3;

  SELECT COALESCE(json_agg(json_build_object('id', w.id, 'name', w.name, 'slug', w.slug)), '[]'::json) INTO v_all_workspaces
  FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = p_user_id;

  RETURN json_build_object(
    'workspace', v_workspace, 'channels', v_channels, 'dm_channels', v_dm_channels,
    'members', v_members, 'unread_counts', v_unread, 'all_workspaces', v_all_workspaces,
    'hitorigoto_channel', v_hitorigoto
  );
END;
$$;

-- ============================================================================
-- 2) get_channel_with_messages (★最重要: 自動 join を含むため漏洩+書込み両方リスク)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_channel_with_messages(p_workspace_slug text, p_channel_slug text, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_workspace_id UUID;
  v_channel JSON;
  v_messages JSON;
  v_is_member BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(c.*) INTO v_channel FROM channels c
    WHERE c.workspace_id = v_workspace_id AND c.slug = p_channel_slug;
  IF v_channel IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS(
    SELECT 1 FROM channel_members
    WHERE channel_id = (v_channel->>'id')::UUID AND user_id = p_user_id
  ) INTO v_is_member;

  IF NOT v_is_member AND NOT (v_channel->>'is_private')::BOOLEAN THEN
    INSERT INTO channel_members (channel_id, user_id)
      VALUES ((v_channel->>'id')::UUID, p_user_id)
      ON CONFLICT DO NOTHING;
  END IF;

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
    WHERE m.channel_id = (v_channel->>'id')::UUID
      AND m.parent_id IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'channel', v_channel,
    'messages', COALESCE(v_messages, '[]'::json)
  );
END;
$$;

-- ============================================================================
-- 3) get_workspace_events (既存 auth check 強化)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_workspace_events(p_workspace_slug text, p_user_id uuid, p_year integer, p_month integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_workspace_id UUID;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end := v_start + INTERVAL '1 month';

  SELECT json_agg(ev ORDER BY ev.start_at ASC)
  INTO v_result
  FROM (
    SELECT
      e.id, e.message_id, e.channel_id, e.created_by, e.title,
      e.start_at, e.location, e.attendee_ids, e.created_at,
      CASE WHEN ch.id IS NOT NULL
        THEN json_build_object('id', ch.id, 'name', ch.name, 'slug', ch.slug)
        ELSE NULL END AS channel,
      json_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url) AS creator,
      (
        SELECT COALESCE(json_agg(
          json_build_object('id', ap.id, 'display_name', ap.display_name, 'avatar_url', ap.avatar_url)
        ), '[]'::json)
        FROM public.profiles ap
        WHERE ap.id = ANY(e.attendee_ids)
      ) AS attendees
    FROM public.events e
    LEFT JOIN public.channels ch ON ch.id = e.channel_id
    JOIN public.profiles p ON p.id = e.created_by
    WHERE e.start_at >= v_start AND e.start_at < v_end
      AND (e.created_by = p_user_id OR p_user_id = ANY(e.attendee_ids))
      AND (e.channel_id IS NULL OR ch.workspace_id = v_workspace_id)
  ) ev;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- ============================================================================
-- 4) search_messages (既存 auth check 強化)
-- ============================================================================
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

-- ============================================================================
-- 5) get_my_activities (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_activities(p_user_id uuid, p_workspace_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(reaction_id uuid, emoji text, reacted_at timestamptz, reactor_id uuid, reactor_name text, reactor_avatar text, message_id uuid, message_content text, channel_id uuid, channel_name text, channel_slug text, is_new boolean)
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
    r.id, r.emoji, r.created_at, r.user_id,
    rp.display_name, rp.avatar_url,
    m.id, m.content,
    c.id, c.name, c.slug,
    (r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz))
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
END;
$$;

-- ============================================================================
-- 6) get_my_mentions (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_mentions(p_user_id uuid, p_workspace_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(mention_id uuid, mentioned_at timestamptz, author_id uuid, author_name text, author_avatar text, message_id uuid, message_content text, channel_id uuid, channel_name text, channel_slug text, is_new boolean)
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
    mn.id, m.created_at, m.user_id,
    p.display_name, p.avatar_url,
    m.id, m.content,
    c.id, c.name, c.slug,
    (m.created_at > COALESCE(self.mention_seen_at, '1970-01-01'::timestamptz))
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
END;
$$;

-- ============================================================================
-- 7) get_my_replies (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_replies(p_user_id uuid, p_workspace_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(reply_id uuid, replied_at timestamptz, replier_id uuid, replier_name text, replier_avatar text, reply_content text, parent_message_id uuid, parent_content text, channel_id uuid, channel_name text, channel_slug text, is_new boolean)
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
    (reply.created_at > COALESCE(self.reply_seen_at, '1970-01-01'::timestamptz))
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

-- ============================================================================
-- 8) get_unread_counts (sql → plpgsql)
-- ============================================================================
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

-- ============================================================================
-- 9) get_unread_counts_by_workspace (sql → plpgsql)
-- ============================================================================
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

-- ============================================================================
-- 10) get_activity_unread_breakdown (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_activity_unread_breakdown(p_user_id uuid, p_workspace_id uuid)
RETURNS TABLE(has_reactions boolean, has_mentions boolean, has_replies boolean)
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
    EXISTS (
      SELECT 1
      FROM public.reactions r
      JOIN public.messages m ON m.id = r.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE m.user_id = p_user_id AND r.user_id <> p_user_id
        AND m.deleted_at IS NULL AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
    ),
    EXISTS (
      SELECT 1
      FROM public.mentions mn
      JOIN public.messages m ON m.id = mn.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE mn.mentioned_user_id = p_user_id AND m.user_id <> p_user_id
        AND m.deleted_at IS NULL AND c.workspace_id = p_workspace_id
        AND m.created_at > COALESCE(p.mention_seen_at, '1970-01-01'::timestamptz)
    ),
    EXISTS (
      SELECT 1
      FROM public.messages r
      JOIN public.messages parent ON parent.id = r.parent_id
      JOIN public.channels c ON c.id = r.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE parent.user_id = p_user_id AND r.user_id <> p_user_id
        AND r.deleted_at IS NULL AND parent.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.reply_seen_at, '1970-01-01'::timestamptz)
    );
END;
$$;

-- ============================================================================
-- 11) has_unread_activity (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.has_unread_activity(p_user_id uuid, p_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN
    EXISTS (
      SELECT 1
      FROM public.reactions r
      JOIN public.messages m ON m.id = r.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE m.user_id = p_user_id AND r.user_id <> p_user_id
        AND m.deleted_at IS NULL AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
    )
    OR EXISTS (
      SELECT 1
      FROM public.mentions mn
      JOIN public.messages m ON m.id = mn.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE mn.mentioned_user_id = p_user_id AND m.user_id <> p_user_id
        AND m.deleted_at IS NULL AND c.workspace_id = p_workspace_id
        AND m.created_at > COALESCE(p.mention_seen_at, '1970-01-01'::timestamptz)
    )
    OR EXISTS (
      SELECT 1
      FROM public.messages r
      JOIN public.messages parent ON parent.id = r.parent_id
      JOIN public.channels c ON c.id = r.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE parent.user_id = p_user_id AND r.user_id <> p_user_id
        AND r.deleted_at IS NULL AND parent.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.reply_seen_at, '1970-01-01'::timestamptz)
    );
END;
$$;

-- ============================================================================
-- 12) get_decision_unread_count (sql → plpgsql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_decision_unread_count(p_workspace_id uuid, p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  SELECT COUNT(m.id) INTO v_count
  FROM public.messages m
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = p_user_id
  WHERE c.workspace_id = p_workspace_id
    AND m.is_decision = TRUE
    AND m.deleted_at IS NULL
    AND m.decision_marked_at IS NOT NULL
    AND m.user_id <> p_user_id
    AND m.decision_marked_at > COALESCE(wm.last_decision_view_at, wm.joined_at, '1970-01-01'::timestamptz)
    AND EXISTS (
      SELECT 1 FROM public.channel_members cm
      WHERE cm.channel_id = m.channel_id AND cm.user_id = p_user_id
    );
  RETURN v_count;
END;
$$;
