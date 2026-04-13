-- 監査ログの改竄検知: ハッシュチェーン
-- 各行に前の行の hash を含めた SHA-256 を持たせる。
-- 誰かが過去の行を書き換えると、以降のすべての hash が不整合になるので検知できる。
--
-- 既存ポリシー(UPDATE/DELETE禁止)と組み合わせて、
-- サーバ管理者や Supabase スタッフですら改竄困難にする。

-- prev_hash と hash を追加（既存行は NULL のまま）
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash TEXT;

-- BEFORE INSERT トリガー: 直前の行の hash を拾って自分の hash を計算する
-- pgcrypto が必要
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.compute_audit_log_hash()
RETURNS TRIGGER AS $$
DECLARE
  v_prev TEXT;
BEGIN
  -- 直前の行（最新の hash 付き行）を取得
  SELECT hash INTO v_prev
  FROM public.audit_logs
  WHERE hash IS NOT NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := v_prev;

  -- hash 計算対象: prev_hash + 内容
  -- created_at は BEFORE INSERT 時点ではデフォルト適用済み(DEFAULT now())
  NEW.hash := encode(
    digest(
      COALESCE(v_prev, '') ||
      NEW.id::text ||
      COALESCE(NEW.workspace_id::text, '') ||
      COALESCE(NEW.user_id::text, '') ||
      NEW.action ||
      COALESCE(NEW.target_type, '') ||
      COALESCE(NEW.target_id, '') ||
      COALESCE(NEW.metadata::text, '') ||
      NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_hash ON public.audit_logs;
CREATE TRIGGER trg_audit_log_hash
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_audit_log_hash();

-- ==========================================
-- 監査ログチェーンの整合性検証 RPC
-- 管理者が「本当に改竄されていないか」を任意のタイミングで検証できる
-- ==========================================
CREATE OR REPLACE FUNCTION public.verify_audit_log_chain(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, bad_rows BIGINT, total_rows BIGINT) AS $$
DECLARE
  v_prev TEXT := NULL;
  v_bad BIGINT := 0;
  v_total BIGINT := 0;
  r RECORD;
  v_expected TEXT;
BEGIN
  FOR r IN
    SELECT *
    FROM public.audit_logs
    WHERE hash IS NOT NULL
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    ORDER BY created_at ASC, id ASC
  LOOP
    v_total := v_total + 1;

    v_expected := encode(
      digest(
        COALESCE(v_prev, '') ||
        r.id::text ||
        COALESCE(r.workspace_id::text, '') ||
        COALESCE(r.user_id::text, '') ||
        r.action ||
        COALESCE(r.target_type, '') ||
        COALESCE(r.target_id, '') ||
        COALESCE(r.metadata::text, '') ||
        r.created_at::text,
        'sha256'
      ),
      'hex'
    );

    IF r.hash <> v_expected OR COALESCE(r.prev_hash, '') <> COALESCE(v_prev, '') THEN
      v_bad := v_bad + 1;
    END IF;

    v_prev := r.hash;
  END LOOP;

  RETURN QUERY SELECT (v_bad = 0)::BOOLEAN, v_bad, v_total;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_audit_log_chain(UUID) TO authenticated;
