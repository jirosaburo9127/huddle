-- 認証試行の記録（ブルートフォース検知・監査用）
-- ログイン失敗時にクライアントから記録する。RLS で他ユーザーのログは見えないようにする。
-- Supabase Auth 本体の IP 単位レート制限と併用することで多層防御になる。

CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email_time
  ON public.failed_login_attempts(email, attempted_at DESC);

ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;

-- 匿名クライアントからでも INSERT だけは許可（未認証のログイン画面から呼ぶため）
-- ただし SELECT はサービスロール / SECURITY DEFINER 関数経由のみ
CREATE POLICY "failed_login_insert_anyone" ON public.failed_login_attempts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ==========================================
-- RPC: 直近のメールアドレス単位失敗数を返す（ロック判定用）
-- 匿名からも呼べるよう SECURITY DEFINER + 関数レベル権限で絞る
-- ==========================================
CREATE OR REPLACE FUNCTION public.count_recent_login_failures(
  p_email TEXT,
  p_window_minutes INT DEFAULT 15
) RETURNS INT AS $$
  SELECT COUNT(*)::INT
  FROM public.failed_login_attempts
  WHERE email = LOWER(p_email)
    AND attempted_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.count_recent_login_failures(TEXT, INT) TO anon, authenticated;

-- ==========================================
-- RPC: 失敗を記録する（emailは lowercase 正規化）
-- INSERT ポリシーで直接でもよいが、emailを小文字統一するため関数経由推奨
-- ==========================================
CREATE OR REPLACE FUNCTION public.record_login_failure(p_email TEXT)
RETURNS VOID AS $$
  INSERT INTO public.failed_login_attempts(email)
  VALUES (LOWER(p_email));
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.record_login_failure(TEXT) TO anon, authenticated;

-- ==========================================
-- 30日以上前のログは自動削除（監査保持期間）
-- pg_cron があれば cronで、なければ関数を手動 or RPC 呼び出しで
-- ==========================================
CREATE OR REPLACE FUNCTION public.cleanup_old_login_failures()
RETURNS VOID AS $$
  DELETE FROM public.failed_login_attempts
  WHERE attempted_at < NOW() - INTERVAL '30 days';
$$ LANGUAGE sql;
