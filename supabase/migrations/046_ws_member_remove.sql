-- ワークスペースメンバーの削除ポリシー + RPC

-- DELETE ポリシー: 同じワークスペースのメンバーなら削除可能
DROP POLICY IF EXISTS "workspace_members_delete" ON public.workspace_members;
CREATE POLICY "workspace_members_delete" ON public.workspace_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- メンバー削除 RPC（関連するチャンネルメンバーシップも一括削除）
CREATE OR REPLACE FUNCTION public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- 呼び出し元がワークスペースメンバーか確認
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = v_caller
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- 自分自身の削除は禁止
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'cannot remove yourself';
  END IF;

  -- そのワークスペース内の全チャンネルからメンバーを削除
  DELETE FROM public.channel_members
  WHERE user_id = p_user_id
    AND channel_id IN (
      SELECT id FROM public.channels WHERE workspace_id = p_workspace_id
    );

  -- ワークスペースメンバーから削除
  DELETE FROM public.workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid, uuid) TO authenticated;
