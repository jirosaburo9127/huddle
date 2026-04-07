-- プロフィール閲覧をワークスペース共有メンバーに制限
-- 同じワークスペースに所属するユーザーのプロフィールのみ閲覧可能にする

-- パフォーマンス用インデックス（存在しなければ作成）
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_ws
  ON public.workspace_members(user_id, workspace_id);

-- 既存ポリシーを置き換え
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm1
      JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid() AND wm2.user_id = profiles.id
    )
  );
