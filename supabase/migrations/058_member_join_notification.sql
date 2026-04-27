-- 招待URL経由でワークスペースに加入したとき、既存メンバーに通知が届くように
-- general チャンネルへ system_event='member_joined' のシステムメッセージを INSERT する。
--
-- これにより:
--   - sidebar.tsx の Realtime INSERT ハンドラが拾って未読バッジを増やす
--   - showMessageNotification でブラウザ通知が飛ぶ（既存パスを再利用）
--   - 加入者本人は user_id === currentUserId でスキップされるため重複通知しない
--   - message-item.tsx 側で system_event='member_joined' を控えめなシステムメッセージ表示にする

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS JSON AS $$
DECLARE
  v_invitation record;
  v_workspace record;
  v_user_id uuid;
  v_general_channel_id uuid;
  v_hitorigoto_channel_id uuid;
  v_display_name text;
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

  -- 独り言チャンネルに自動参加
  SELECT id INTO v_hitorigoto_channel_id FROM public.channels
    WHERE workspace_id = v_invitation.workspace_id AND is_hitorigoto = true LIMIT 1;

  IF v_hitorigoto_channel_id IS NOT NULL THEN
    INSERT INTO public.channel_members (channel_id, user_id) VALUES (v_hitorigoto_channel_id, v_user_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.workspace_invitations SET use_count = use_count + 1 WHERE id = v_invitation.id;

  -- 既存メンバーへの加入通知: general チャンネルにシステムメッセージ
  -- v_general_channel_id が NULL の場合（general を削除済みなど）はスキップ
  IF v_general_channel_id IS NOT NULL THEN
    SELECT display_name INTO v_display_name FROM public.profiles WHERE id = v_user_id;
    INSERT INTO public.messages (channel_id, user_id, content, system_event)
    VALUES (
      v_general_channel_id,
      v_user_id,
      '👋 ' || COALESCE(v_display_name, 'メンバー') || ' がワークスペースに参加しました',
      'member_joined'
    );
  END IF;

  SELECT slug INTO v_workspace FROM public.workspaces WHERE id = v_invitation.workspace_id;
  RETURN json_build_object('status', 'joined', 'workspace_slug', v_workspace.slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
