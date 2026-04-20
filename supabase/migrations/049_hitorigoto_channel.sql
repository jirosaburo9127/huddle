-- 独り言チャンネル機能
-- ワークスペースに1つの共有タイムライン（Twitter/Threads風）
-- 全メンバーが閲覧・投稿可能、リアクション+返信あり

-- ==========================================
-- 1. channels テーブルに is_hitorigoto カラム追加
-- ==========================================
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS is_hitorigoto boolean NOT NULL DEFAULT false;

-- ワークスペースごとに最大1つの独り言チャンネル
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_one_hitorigoto_per_ws
  ON public.channels(workspace_id) WHERE is_hitorigoto = true;

-- ==========================================
-- 2. 既存ワークスペースに独り言チャンネルを自動作成
-- ==========================================
DO $$
DECLARE
  v_ws record;
  v_channel_id uuid;
  v_owner_id uuid;
BEGIN
  FOR v_ws IN SELECT id FROM workspaces LOOP
    -- 既に存在する場合はスキップ
    IF NOT EXISTS (SELECT 1 FROM channels WHERE workspace_id = v_ws.id AND is_hitorigoto = true) THEN
      -- ワークスペースオーナー（最初のメンバー）を作成者に
      SELECT user_id INTO v_owner_id FROM workspace_members WHERE workspace_id = v_ws.id ORDER BY joined_at ASC LIMIT 1;

      INSERT INTO channels (workspace_id, name, slug, is_private, is_dm, is_hitorigoto, created_by)
      VALUES (v_ws.id, '独り言', 'hitorigoto', false, false, true, v_owner_id)
      RETURNING id INTO v_channel_id;

      -- 全メンバーを追加
      INSERT INTO channel_members (channel_id, user_id)
      SELECT v_channel_id, wm.user_id
      FROM workspace_members wm
      WHERE wm.workspace_id = v_ws.id
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ==========================================
-- 3. get_workspace_data を更新: hitorigoto_channel を別フィールドで返す
--    通常のchannelsからは除外
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
  v_hitorigoto JSON;
BEGIN
  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(w.*) INTO v_workspace FROM workspaces w WHERE w.id = v_workspace_id;

  -- 通常チャンネル（DM・独り言を除外）
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

  -- DMチャンネル
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

  -- 独り言チャンネル
  SELECT row_to_json(hc) INTO v_hitorigoto
  FROM (
    SELECT c.id, c.slug, c.name
    FROM channels c
    WHERE c.workspace_id = v_workspace_id
      AND c.is_hitorigoto = true
    LIMIT 1
  ) hc;

  -- メンバー
  SELECT COALESCE(json_agg(json_build_object(
    'user_id', wm.user_id,
    'profiles', json_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'status', p.status)
  )), '[]'::json) INTO v_members
  FROM workspace_members wm JOIN profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id;

  -- 未読数
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

  -- 全ワークスペース
  SELECT COALESCE(json_agg(json_build_object('id', w.id, 'name', w.name, 'slug', w.slug)), '[]'::json) INTO v_all_workspaces
  FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = p_user_id;

  RETURN json_build_object(
    'workspace', v_workspace, 'channels', v_channels, 'dm_channels', v_dm_channels,
    'members', v_members, 'unread_counts', v_unread, 'all_workspaces', v_all_workspaces,
    'hitorigoto_channel', v_hitorigoto
  );
END;
$function$;

-- ==========================================
-- 4. accept_invitation を更新: 独り言チャンネルにも自動参加
-- ==========================================
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS JSON AS $$
DECLARE
  v_invitation record;
  v_workspace record;
  v_user_id uuid;
  v_general_channel_id uuid;
  v_hitorigoto_channel_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invitation FROM public.workspace_invitations
    WHERE token = p_token AND is_active = true AND expires_at > now()
    AND (max_uses IS NULL OR use_count < max_uses);

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_or_expired');
  END IF;

  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = v_invitation.workspace_id AND user_id = v_user_id) THEN
    SELECT slug INTO v_workspace FROM public.workspaces WHERE id = v_invitation.workspace_id;
    RETURN json_build_object('status', 'already_member', 'workspace_slug', v_workspace.slug);
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_invitation.workspace_id, v_user_id, 'member');

  -- generalチャンネルに自動参加
  SELECT id INTO v_general_channel_id FROM public.channels
    WHERE workspace_id = v_invitation.workspace_id AND slug = 'general' LIMIT 1;

  IF v_general_channel_id IS NOT NULL THEN
    INSERT INTO public.channel_members (channel_id, user_id) VALUES (v_general_channel_id, v_user_id) ON CONFLICT DO NOTHING;
  END IF;

  -- ��り言チャンネルに自動参加
  SELECT id INTO v_hitorigoto_channel_id FROM public.channels
    WHERE workspace_id = v_invitation.workspace_id AND is_hitorigoto = true LIMIT 1;

  IF v_hitorigoto_channel_id IS NOT NULL THEN
    INSERT INTO public.channel_members (channel_id, user_id) VALUES (v_hitorigoto_channel_id, v_user_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.workspace_invitations SET use_count = use_count + 1 WHERE id = v_invitation.id;

  SELECT slug INTO v_workspace FROM public.workspaces WHERE id = v_invitation.workspace_id;
  RETURN json_build_object('status', 'joined', 'workspace_slug', v_workspace.slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
