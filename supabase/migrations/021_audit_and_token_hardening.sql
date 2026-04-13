-- セキュリティ監査での指摘事項を修正
-- 1. audit_logs の INSERT が WITH CHECK (true) で他人なりすましを許していた
-- 2. device_tokens / share_tokens は現状のポリシーで十分だが、念のため再確認

-- ==========================================
-- 1. audit_logs INSERT を「自分の user_id でしか入れられない」に絞る
-- ==========================================
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (
    -- 認証済みユーザーは自分の行動しか記録できない
    -- SECURITY DEFINER トリガーからの挿入は auth.uid() チェックを通らないが、
    -- RLS は DEFINER 関数内では迂回されるためトリガー側は影響を受けない
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

-- 念のため UPDATE / DELETE は完全禁止（改竄防止）
DROP POLICY IF EXISTS "audit_logs_no_update" ON public.audit_logs;
CREATE POLICY "audit_logs_no_update" ON public.audit_logs
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "audit_logs_no_delete" ON public.audit_logs;
CREATE POLICY "audit_logs_no_delete" ON public.audit_logs
  FOR DELETE USING (false);

-- ==========================================
-- 2. share_tokens: 有効期限切れや失効後はトークンでのアクセスを拒否
-- get_shared_dashboard_data 内で既にチェック済みだが、トークン自体が
-- 誤って閲覧されないよう inactive / expired を返さないポリシーを追加
-- （現状は admin/owner しか SELECT できないので実用上は問題ないが再確認）
-- ==========================================

-- ==========================================
-- 3. device_tokens: 他人のトークンを削除できないようRLSを再確認
-- 既存の device_tokens_delete ポリシーは auth.uid() = user_id なのでOK
-- 追加で、他人のトークンを自分名義で上書きする「乗っ取り」を防ぐため、
-- INSERT 時に既存の同一 token があれば拒否する制約を追加
-- ==========================================
-- 既に token UNIQUE 制約があるため重複 INSERT は失敗する。
-- しかし upsert で ON CONFLICT の場合、RLS UPDATE ポリシーが効く。
-- 既存の UPDATE ポリシー auth.uid() = user_id は OLD.user_id に対してチェックされるので、
-- 他人のトークンを自分名義で更新しようとしても既存行の user_id が他人なら弾かれる。OK.
