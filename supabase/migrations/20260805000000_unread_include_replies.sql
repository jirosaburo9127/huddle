-- 未読カウントに返信(スレッド)メッセージも含める。
-- Huddle は返信もメインフィードに表示する仕様なのに、未読RPCが parent_id IS NULL で
-- 返信を除外していたため「返信が来ても画面には出るがバッジが付かない」ズレが発生していた。
-- 表示とカウントを一致させるため、parent_id IS NULL 条件を撤去する。

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
 RETURNS TABLE(channel_id uuid, unread_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  SELECT cm.channel_id, COUNT(m.id)
  FROM channel_members cm
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY cm.channel_id
  HAVING COUNT(m.id) > 0;
END;
$function$;

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
  SELECT c.workspace_id, COUNT(m.id)
  FROM channel_members cm
  JOIN channels c ON c.id = cm.channel_id
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY c.workspace_id
  HAVING COUNT(m.id) > 0;
END;
$function$;

-- SSR初期描画用のまとめRPCも同様に返信を含める（parent_id IS NULL 撤去）
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

  -- ãã£ã³ãã«: ææ°ã¡ãã»ã¼ã¸é ã«ã½ã¼ã
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
    jsonb_build_object('channel_id', sub2.channel_id, 'unread_count', sub2.cnt)
  ), '[]'::jsonb)
  INTO v_unread_counts
  FROM (
    SELECT cm.channel_id, COUNT(m.id) AS cnt
    FROM channel_members cm
    JOIN messages m ON m.channel_id = cm.channel_id
      AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
      AND m.deleted_at IS NULL
      AND m.user_id != p_user_id
    WHERE cm.user_id = p_user_id
    GROUP BY cm.channel_id
    HAVING COUNT(m.id) > 0
  ) sub2;

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
$function$

;
