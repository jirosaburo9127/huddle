-- ワークスペース削除を可能にするための修正
--
-- 問題: audit_logs.workspace_id FK が CASCADE なしのため、
-- ワークスペース削除時に channels のトリガーが audit_logs に INSERT しようとして
-- FK 違反が発生していた。
--
-- 修正1: audit_logs の workspace_id FK を ON DELETE CASCADE に変更
-- 修正2: ワークスペース削除用の SECURITY DEFINER RPC を追加

-- audit_logs FK を ON DELETE CASCADE に変更
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_workspace_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- ワークスペース削除 RPC
-- オーナーのみ実行可能。関連データを全て削除する。
CREATE OR REPLACE FUNCTION public.delete_workspace(p_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- オーナーかチェック
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = v_user_id
      AND role = 'owner'
  ) THEN
    RETURN json_build_object('error', 'owner_only');
  END IF;

  -- 関連データを削除（CASCADE で大部分は自動的に消えるが、明示的に順序制御）
  -- 1. メッセージ関連（mentions, reactions, files はメッセージの FK CASCADE で消える）
  DELETE FROM messages WHERE channel_id IN (
    SELECT id FROM channels WHERE workspace_id = p_workspace_id
  );
  -- 2. チャンネルメンバー
  DELETE FROM channel_members WHERE channel_id IN (
    SELECT id FROM channels WHERE workspace_id = p_workspace_id
  );
  -- 3. チャンネル（audit_logs トリガーが発火するが、audit_logs は CASCADE で消えるので OK）
  DELETE FROM channels WHERE workspace_id = p_workspace_id;
  -- 4. 招待
  DELETE FROM workspace_invitations WHERE workspace_id = p_workspace_id;
  -- 5. 共有トークン
  DELETE FROM share_tokens WHERE workspace_id = p_workspace_id;
  -- 6. ワークスペースメンバー
  DELETE FROM workspace_members WHERE workspace_id = p_workspace_id;
  -- 7. 監査ログ（CASCADE で消えるはずだが念のため）
  DELETE FROM audit_logs WHERE workspace_id = p_workspace_id;
  -- 8. ワークスペース本体
  DELETE FROM workspaces WHERE id = p_workspace_id;

  RETURN json_build_object('status', 'deleted');
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_workspace(uuid) TO authenticated;
