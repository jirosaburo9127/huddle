-- チャンネル作成を「channels insert + 作成者を channel_members に追加」の atomic RPC にまとめる
--
-- 背景: 012 で channels_select が is_channel_member ベースになったため、
-- 作成直後に .insert().select() を呼ぶとまだ channel_members に作成者が居らず
-- "new row violates row-level security policy for table channels" で失敗していた。
-- SECURITY DEFINER で RLS をバイパスしつつ、内部で明示的に認可チェックを行う。

CREATE OR REPLACE FUNCTION public.create_channel_with_member(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_is_private boolean
)
RETURNS public.channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_channel public.channels;
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

  -- 作成者を自動的にチャンネルメンバーに追加（招待制の文脈でも作成者は確実に見える）
  INSERT INTO public.channel_members (channel_id, user_id)
  VALUES (v_channel.id, v_user_id);

  RETURN v_channel;
END;
$$;

-- 認証済みユーザーに実行権限を付与
GRANT EXECUTE ON FUNCTION public.create_channel_with_member(uuid, text, text, boolean) TO authenticated;
