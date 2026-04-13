-- チャンネル作成時に複数のメンバーを一括で追加できるようにする
-- 既存の create_channel_with_member() は作成者だけを追加していた。
-- 追加の RPC create_channel_with_members() を追加。
-- メンバーIDの配列を受け取り、全員を channel_members に atomic 追加する。

CREATE OR REPLACE FUNCTION public.create_channel_with_members(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_is_private boolean,
  p_member_ids uuid[]
)
RETURNS public.channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_channel public.channels;
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 呼び出しユーザーが該当ワークスペースのメンバーであることを確認
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a workspace member';
  END IF;

  -- チャンネル作成
  INSERT INTO public.channels (workspace_id, name, slug, is_private, created_by)
  VALUES (p_workspace_id, p_name, p_slug, p_is_private, v_user_id)
  RETURNING * INTO v_channel;

  -- 作成者を必ず追加
  INSERT INTO public.channel_members (channel_id, user_id)
  VALUES (v_channel.id, v_user_id)
  ON CONFLICT DO NOTHING;

  -- 指定された追加メンバーを追加
  -- ただしワークスペースメンバーに限定する（他WSのユーザーを紛れ込ませない）
  IF p_member_ids IS NOT NULL THEN
    FOREACH v_member_id IN ARRAY p_member_ids LOOP
      IF v_member_id = v_user_id THEN CONTINUE; END IF;
      IF EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = v_member_id
      ) THEN
        INSERT INTO public.channel_members (channel_id, user_id)
        VALUES (v_channel.id, v_member_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_channel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_channel_with_members(uuid, text, text, boolean, uuid[]) TO authenticated;
