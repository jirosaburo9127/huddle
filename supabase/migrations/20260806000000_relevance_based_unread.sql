-- 未読バッジ／通知を「自分に関係するものだけ」に作り替える。
-- 通常チャンネルの未読 = 自分への返信 / @自分 / @all(mention_type='channel')。
-- DMチャンネルは全メッセージが対象（DM自体が自分宛のため）。
-- 一般の雑談メッセージはバッジを付けない（従来は全メッセージをカウントしていた）。
-- リアクションはチャンネルバッジに含めない（幽霊バッジ回避。アクティビティ/ベルで拾う）。

-- 1メッセージが自分に関係するか判定（クライアントのRealtimeハンドラから使う）
CREATE OR REPLACE FUNCTION public.is_message_relevant_to_user(p_message_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_channel uuid;
  v_author uuid;
  v_parent uuid;
  v_deleted timestamptz;
  v_is_dm boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  SELECT channel_id, user_id, parent_id, deleted_at
    INTO v_channel, v_author, v_parent, v_deleted
    FROM messages WHERE id = p_message_id;
  IF v_channel IS NULL OR v_deleted IS NOT NULL OR v_author = p_user_id THEN
    RETURN false;
  END IF;
  SELECT is_dm INTO v_is_dm FROM channels WHERE id = v_channel;
  IF v_is_dm THEN RETURN true; END IF;
  -- 自分への返信
  IF v_parent IS NOT NULL AND EXISTS (
    SELECT 1 FROM messages pm WHERE pm.id = v_parent AND pm.user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;
  -- @自分 または @all
  IF EXISTS (
    SELECT 1 FROM mentions mn WHERE mn.message_id = p_message_id
      AND (mn.mentioned_user_id = p_user_id OR mn.mention_type = 'channel')
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- チャンネル別の未読数（関連するものだけ）
CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
 RETURNS TABLE(channel_id uuid, unread_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  -- 注: リアクションはチャンネルバッジに含めない（「新着メッセージが無いのにバッジ＝幽霊バッジ」に
  -- なり分かりづらいため）。自分へのリアクションはアクティビティ(ベル)側で拾う。
  RETURN QUERY
  WITH mem AS (
    SELECT cm.channel_id AS ch, COALESCE(cm.last_read_at, cm.joined_at) AS since, c.is_dm
    FROM channel_members cm
    JOIN channels c ON c.id = cm.channel_id
    WHERE cm.user_id = p_user_id
  )
  SELECT mem.ch, COUNT(*)::bigint
  FROM mem
  JOIN messages m ON m.channel_id = mem.ch
    AND m.created_at > mem.since
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE mem.is_dm
     OR (m.parent_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM messages pm WHERE pm.id = m.parent_id AND pm.user_id = p_user_id))
     OR EXISTS (
           SELECT 1 FROM mentions mn WHERE mn.message_id = m.id
             AND (mn.mentioned_user_id = p_user_id OR mn.mention_type = 'channel'))
  GROUP BY mem.ch
  HAVING COUNT(*) > 0;
END;
$function$;

-- ワークスペース別の未読数（get_unread_counts を集約して唯一の定義に統一）
CREATE OR REPLACE FUNCTION public.get_unread_counts_by_workspace(p_user_id uuid)
 RETURNS TABLE(workspace_id uuid, unread_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  SELECT c.workspace_id, SUM(g.unread_count)::bigint
  FROM get_unread_counts(p_user_id) g
  JOIN channels c ON c.id = g.channel_id
  GROUP BY c.workspace_id;
END;
$function$;


-- SSR初期描画のまとめRPCも未読を get_unread_counts に統一（relevanceベース）
CREATE OR REPLACE FUNCTION public.get_workspace_data(p_workspace_slug text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_workspace workspaces;
  v_channels jsonb;
  v_dm_channels jsonb;
  v_members jsonb;
  v_unread_counts jsonb;
  v_categories jsonb;
  v_hitorigoto jsonb;
  v_all_workspaces jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT * INTO v_workspace FROM workspaces WHERE slug = p_workspace_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = v_workspace.id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.last_activity DESC NULLS LAST), '[]'::jsonb)
  INTO v_channels
  FROM (
    SELECT ch.*,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = ch.id AND m.deleted_at IS NULL) AS last_activity
    FROM channels ch
    INNER JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = p_user_id
    WHERE ch.workspace_id = v_workspace.id
      AND ch.is_dm = false
      AND ch.is_hitorigoto = false
      AND ch.is_archived = false
  ) sub;

  SELECT COALESCE(jsonb_agg(
    row_to_json(ch)::jsonb || jsonb_build_object(
      'channel_members', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'user_id', cm2.user_id,
            'profiles', (
              SELECT jsonb_build_object(
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'status', p.status,
                'last_seen_at', p.last_seen_at
              )
              FROM profiles p WHERE p.id = cm2.user_id
            )
          )
        ), '[]'::jsonb)
        FROM channel_members cm2 WHERE cm2.channel_id = ch.id
      )
    )
  ), '[]'::jsonb)
  INTO v_dm_channels
  FROM channels ch
  WHERE ch.workspace_id = v_workspace.id
    AND ch.is_dm = true
    AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = ch.id AND cm.user_id = p_user_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', wm.user_id,
      'profiles', (
        SELECT jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', p.status)
        FROM profiles p WHERE p.id = wm.user_id
      )
    )
  ), '[]'::jsonb)
  INTO v_members
  FROM workspace_members wm
  WHERE wm.workspace_id = v_workspace.id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('channel_id', g.channel_id, 'unread_count', g.unread_count)
  ), '[]'::jsonb)
  INTO v_unread_counts
  FROM get_unread_counts(p_user_id) g
  JOIN channels c ON c.id = g.channel_id
  WHERE c.workspace_id = v_workspace.id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('slug', wc.slug, 'label', wc.label, 'color', wc.color, 'sort_order', wc.sort_order)
    ORDER BY wc.sort_order
  ), '[]'::jsonb)
  INTO v_categories
  FROM workspace_categories wc
  WHERE wc.workspace_id = v_workspace.id;

  SELECT jsonb_build_object('id', ch.id, 'slug', ch.slug, 'name', ch.name)
  INTO v_hitorigoto
  FROM channels ch
  WHERE ch.workspace_id = v_workspace.id AND ch.is_hitorigoto = true
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug)
    ORDER BY w.name
  ), '[]'::jsonb)
  INTO v_all_workspaces
  FROM workspaces w
  WHERE EXISTS (SELECT 1 FROM workspace_members wm2 WHERE wm2.workspace_id = w.id AND wm2.user_id = p_user_id);

  RETURN jsonb_build_object(
    'workspace', row_to_json(v_workspace)::jsonb,
    'channels', v_channels,
    'dm_channels', v_dm_channels,
    'members', v_members,
    'unread_counts', v_unread_counts,
    'categories', v_categories,
    'hitorigoto_channel', COALESCE(v_hitorigoto, 'null'::jsonb),
    'all_workspaces', v_all_workspaces,
    'is_master', false
  );
END;
$function$;
