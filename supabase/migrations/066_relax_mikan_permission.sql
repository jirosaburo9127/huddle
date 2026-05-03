-- みかん有効化の権限を「ワークスペースメンバーなら誰でも」に緩める
-- (旧仕様: owner / admin のみ実行可)
-- チームでみかんを使い始めるハードルを下げるため

CREATE OR REPLACE FUNCTION public.set_mikan_enabled(
  p_channel_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_workspace_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id FROM public.channels WHERE id = p_channel_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;

  -- ワークスペースメンバーなら誰でも操作可
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = v_workspace_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a workspace member';
  END IF;

  UPDATE public.channels SET mikan_enabled = p_enabled WHERE id = p_channel_id;
END;
$$;
