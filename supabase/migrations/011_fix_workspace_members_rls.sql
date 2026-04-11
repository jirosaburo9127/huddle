-- workspace_members_select のRLSを修正
--
-- 問題: 現状 `auth.uid() = user_id` になっており、ユーザーは自分の workspace_members 行しか
--       読めない。そのため @メンション候補やメンバー一覧が自分だけになる。
--
-- 解決: 007 の is_channel_member と同様に SECURITY DEFINER ヘルパーを作って再帰を断ち、
--       「自分が所属するワークスペースのメンバーは全員見える」ポリシーに差し替える。

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id
  );
$$;

DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
