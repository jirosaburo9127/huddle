-- ミュート機能を完全削除
--
-- 通知ポリシーを「メンション/DM/スレッド/投票のみバナー、それ以外はバッジのみ」に
-- 変更した時点でミュートの本来の役割 (バナーを黙らせる) はほぼ無くなっていた。
-- UI を簡素化しバグの温床を減らすため、機能ごと削除する。
--
-- 変更内容:
-- 1. 関連 RPC から muted フィルタを取り除く
-- 2. channel_members.muted カラムを DROP
--
-- 将来復活したくなった場合は 001 / 010 / 017 を参照

-- ==========================================
-- get_unread_counts: muted フィルタを削除
-- (034 で追加した m.user_id <> p_user_id は維持)
-- ==========================================
CREATE OR REPLACE FUNCTION get_unread_counts(p_user_id UUID)
RETURNS TABLE(channel_id UUID, unread_count BIGINT) AS $$
  SELECT cm.channel_id, COUNT(m.id) as unread_count
  FROM channel_members cm
  JOIN messages m ON m.channel_id = cm.channel_id
    AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
    AND m.parent_id IS NULL
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
  WHERE cm.user_id = p_user_id
  GROUP BY cm.channel_id
  HAVING COUNT(m.id) > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==========================================
-- get_unread_counts_by_workspace: muted フィルタを削除
-- ==========================================
CREATE OR REPLACE FUNCTION get_unread_counts_by_workspace(p_user_id UUID)
RETURNS TABLE(workspace_id UUID, unread_count BIGINT) AS $$
  SELECT c.workspace_id, COUNT(m.id) as unread_count
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
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_unread_counts_by_workspace(UUID) TO authenticated;

-- ==========================================
-- get_workspace_data: unread サブクエリから muted フィルタを削除
-- 同時に m.user_id <> p_user_id (自分の投稿は未読にしない) も反映
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_workspace_data(p_workspace_slug text, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_workspace_id UUID;
  v_workspace JSON;
  v_channels JSON;
  v_dm_channels JSON;
  v_members JSON;
  v_unread JSON;
  v_all_workspaces JSON;
BEGIN
  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(w.*) INTO v_workspace FROM workspaces w WHERE w.id = v_workspace_id;

  SELECT COALESCE(json_agg(sub ORDER BY sub.created_at ASC), '[]'::json) INTO v_channels
  FROM (
    SELECT c.*
    FROM channels c
    WHERE c.workspace_id = v_workspace_id
      AND c.is_dm = false
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
    'members', v_members, 'unread_counts', v_unread, 'all_workspaces', v_all_workspaces
  );
END;
$function$;

-- ==========================================
-- カラムを削除 (全ての参照を削除した後で実行)
-- ==========================================
ALTER TABLE public.channel_members DROP COLUMN IF EXISTS muted;
