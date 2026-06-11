-- チャンネル招待承認時に参加メッセージを投稿する
-- 既にメンバーの場合はメッセージを投稿しない

CREATE OR REPLACE FUNCTION public.accept_channel_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation channel_invitations;
  v_user_id uuid := auth.uid();
  v_channel channels;
  v_workspace workspaces;
  v_display_name text;
  v_already_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_invitation FROM channel_invitations
    WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_channel FROM channels WHERE id = v_invitation.channel_id;
  SELECT * INTO v_workspace FROM workspaces WHERE id = v_invitation.workspace_id;

  -- 表示名を取得
  SELECT display_name INTO v_display_name FROM profiles WHERE id = v_user_id;

  -- 既にチャンネルメンバーかチェック
  SELECT EXISTS(
    SELECT 1 FROM channel_members
    WHERE channel_id = v_invitation.channel_id AND user_id = v_user_id
  ) INTO v_already_member;

  -- ワークスペース参加
  INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_invitation.workspace_id, v_user_id, 'member')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- チャンネル参加
  INSERT INTO channel_members (channel_id, user_id)
    VALUES (v_invitation.channel_id, v_user_id)
    ON CONFLICT (channel_id, user_id) DO NOTHING;

  -- general チャンネルにも自動参加
  INSERT INTO channel_members (channel_id, user_id)
    SELECT id, v_user_id FROM channels
    WHERE workspace_id = v_invitation.workspace_id AND slug = 'general' AND is_dm = false
    ON CONFLICT (channel_id, user_id) DO NOTHING;

  -- 新規参加の場合のみ参加メッセージを投稿
  IF NOT v_already_member THEN
    INSERT INTO messages (channel_id, user_id, content, system_event)
      VALUES (
        v_invitation.channel_id,
        v_user_id,
        '🟢 ' || COALESCE(v_display_name, '新しいメンバー') || ' が参加しました',
        'member_joined'
      );
  END IF;

  RETURN jsonb_build_object(
    'workspace_slug', v_workspace.slug,
    'channel_slug', v_channel.slug
  );
END;
$$;
