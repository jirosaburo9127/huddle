-- 通知不安定の根本対策: APNs JWT 生成を pg_advisory_xact_lock で直列化する
--
-- 問題:
-- 複数のメッセージがほぼ同時に来ると、Edge Function インスタンスが並列に立ち上がる。
-- 各インスタンスが apns_jwt_cache を見て expired と判断すると、それぞれが
-- 独立に新しい JWT を生成して APNs に投げる。APNs は同一プロバイダから 20 分以内の
-- 「JWT update」が一定数を超えると 429 TooManyProviderTokenUpdates を返すため、
-- 後続インスタンスのプッシュが軒並み失敗する。
--
-- 対策:
-- get_or_set_apns_jwt RPC で読み出しと書き込みを 1 トランザクションに包み、
-- pg_advisory_xact_lock で完全に直列化する。後続インスタンスは先行が書いた
-- JWT を取得して使う (生成済みでも捨てる) ので APNs に送られる新規 JWT は 1 つだけ。

CREATE OR REPLACE FUNCTION public.get_or_set_apns_jwt(
  p_candidate_token text DEFAULT NULL,
  p_candidate_expires timestamptz DEFAULT NULL
)
RETURNS TABLE(
  token text,
  expires_at timestamptz,
  was_existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_expires timestamptz;
BEGIN
  -- 同一プロセスタイミングを直列化。lock key は適当な定数 (apns 用)。
  PERFORM pg_advisory_xact_lock(742857142);

  -- 既存キャッシュがあり、有効期限まで 1 分以上あれば再利用
  SELECT c.token, c.expires_at INTO v_token, v_expires
  FROM public.apns_jwt_cache c
  WHERE c.id = 1;

  IF v_token IS NOT NULL AND v_expires > now() + interval '1 minute' THEN
    token := v_token;
    expires_at := v_expires;
    was_existing := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 既存キャッシュがない/期限切れ。caller が候補を渡してなければ
  -- 「あなたが生成してもう一度呼んで」のシグナルとして NULL を返す
  IF p_candidate_token IS NULL THEN
    token := NULL;
    expires_at := NULL;
    was_existing := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 候補を保存。pg_advisory_xact_lock で他インスタンスは待たされているため、
  -- 後から来たインスタンスはここを通る前に上の SELECT で先行のJWTを取得して終わる。
  INSERT INTO public.apns_jwt_cache (id, token, expires_at, updated_at)
  VALUES (1, p_candidate_token, p_candidate_expires, now())
  ON CONFLICT (id) DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

  token := p_candidate_token;
  expires_at := p_candidate_expires;
  was_existing := FALSE;
  RETURN NEXT;
END;
$$;

-- pg_advisory_xact_lock はトランザクション終了時に自動解放されるので明示的な解放不要
GRANT EXECUTE ON FUNCTION public.get_or_set_apns_jwt(text, timestamptz) TO service_role;
