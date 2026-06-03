-- チャンネル招待テーブル
CREATE TABLE IF NOT EXISTS channel_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex') UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '30 days'
);

-- RLS
ALTER TABLE channel_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel_invitations_select" ON channel_invitations FOR SELECT USING (true);
CREATE POLICY "channel_invitations_insert" ON channel_invitations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = channel_invitations.workspace_id AND user_id = auth.uid())
);

-- チャンネル招待情報を取得するRPC
CREATE OR REPLACE FUNCTION get_channel_invitation_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_invitation channel_invitations;
  v_channel channels;
  v_workspace workspaces;
BEGIN
  SELECT * INTO v_invitation FROM channel_invitations WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_channel FROM channels WHERE id = v_invitation.channel_id;
  SELECT * INTO v_workspace FROM workspaces WHERE id = v_invitation.workspace_id;

  RETURN jsonb_build_object(
    'channel_name', v_channel.name,
    'channel_slug', v_channel.slug,
    'workspace_name', v_workspace.name,
    'workspace_slug', v_workspace.slug
  );
END;
$$;

-- チャンネル招待を受け入れるRPC（WS参加 + チャンネル参加を同時に行う）
CREATE OR REPLACE FUNCTION accept_channel_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_invitation channel_invitations;
  v_user_id uuid := auth.uid();
  v_channel channels;
  v_workspace workspaces;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_invitation FROM channel_invitations WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_channel FROM channels WHERE id = v_invitation.channel_id;
  SELECT * INTO v_workspace FROM workspaces WHERE id = v_invitation.workspace_id;

  -- ワークスペースに未参加なら参加
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_invitation.workspace_id, v_user_id, 'member')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- チャンネルに未参加なら参加
  INSERT INTO channel_members (channel_id, user_id)
  VALUES (v_invitation.channel_id, v_user_id)
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  -- generalチャンネルにも自動参加（あれば）
  INSERT INTO channel_members (channel_id, user_id)
  SELECT id, v_user_id FROM channels
  WHERE workspace_id = v_invitation.workspace_id AND slug = 'general' AND is_dm = false
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'workspace_slug', v_workspace.slug,
    'channel_slug', v_channel.slug
  );
END;
$$;

-- get_workspace_data を修正: チャンネルをchannel_membersでフィルタ
CREATE OR REPLACE FUNCTION get_workspace_data(p_workspace_slug text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE
  v_workspace workspaces;
  v_channels jsonb;
  v_dm_channels jsonb;
  v_members jsonb;
  v_unread_counts jsonb;
  v_categories jsonb;
  v_hitorigoto jsonb;
BEGIN
  -- ワークスペース
  SELECT * INTO v_workspace FROM workspaces WHERE slug = p_workspace_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- メンバー確認
  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = v_workspace.id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  -- 通常チャンネル（自分がchannel_membersに入っているもののみ）
  SELECT COALESCE(jsonb_agg(row_to_json(ch)::jsonb ORDER BY ch.name), '[]'::jsonb)
  INTO v_channels
  FROM channels ch
  INNER JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = p_user_id
  WHERE ch.workspace_id = v_workspace.id
    AND ch.is_dm = false
    AND ch.is_hitorigoto = false;

  -- DMチャンネル
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

  -- メンバー一覧
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', wm.user_id,
      'profiles', (
        SELECT jsonb_build_object(
          'id', p.id,
          'display_name', p.display_name,
          'avatar_url', p.avatar_url,
          'status', p.status
        )
        FROM profiles p WHERE p.id = wm.user_id
      )
    )
  ), '[]'::jsonb)
  INTO v_members
  FROM workspace_members wm
  WHERE wm.workspace_id = v_workspace.id;

  -- 未読カウント
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('channel_id', sub.channel_id, 'unread_count', sub.cnt)
  ), '[]'::jsonb)
  INTO v_unread_counts
  FROM (
    SELECT cm.channel_id, COUNT(m.id) AS cnt
    FROM channel_members cm
    JOIN messages m ON m.channel_id = cm.channel_id
      AND m.created_at > cm.last_read_at
      AND m.deleted_at IS NULL
      AND m.user_id != p_user_id
    WHERE cm.user_id = p_user_id
    GROUP BY cm.channel_id
    HAVING COUNT(m.id) > 0
  ) sub;

  -- カテゴリ
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('slug', wc.slug, 'label', wc.label, 'color', wc.color, 'sort_order', wc.sort_order)
    ORDER BY wc.sort_order
  ), '[]'::jsonb)
  INTO v_categories
  FROM workspace_categories wc
  WHERE wc.workspace_id = v_workspace.id;

  -- 独り言チャンネル
  SELECT jsonb_build_object('id', ch.id, 'slug', ch.slug, 'name', ch.name)
  INTO v_hitorigoto
  FROM channels ch
  WHERE ch.workspace_id = v_workspace.id AND ch.is_hitorigoto = true
  LIMIT 1;

  RETURN jsonb_build_object(
    'workspace', row_to_json(v_workspace)::jsonb,
    'channels', v_channels,
    'dm_channels', v_dm_channels,
    'members', v_members,
    'unread_counts', v_unread_counts,
    'categories', v_categories,
    'hitorigoto_channel', COALESCE(v_hitorigoto, 'null'::jsonb),
    'is_master', false
  );
END;
$$;
