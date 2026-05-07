-- iCal エクスポート用のユーザ別トークン。
-- 1ユーザにつき 1 トークン。Apple/Google/Outlook など Bearer 認証に対応していない
-- カレンダーアプリから URL に埋め込んで購読してもらうための secret。
-- 漏洩時は rotate_user_calendar_token() で破棄+再発行できる。

CREATE TABLE IF NOT EXISTS public.user_calendar_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_calendar_tokens_token_idx
  ON public.user_calendar_tokens(token);

-- RLS: 本人だけが自分の行を SELECT できる。INSERT/UPDATE は SECURITY DEFINER 経由のみ
ALTER TABLE public.user_calendar_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_calendar_tokens_select_self ON public.user_calendar_tokens;
CREATE POLICY user_calendar_tokens_select_self ON public.user_calendar_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- 自分の token を取得 (なければ生成)
CREATE OR REPLACE FUNCTION public.ensure_user_calendar_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_token TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT token INTO v_token FROM public.user_calendar_tokens WHERE user_id = v_user_id;

  IF v_token IS NULL THEN
    -- 73 文字の URL-safe な secret (UUID 2 個結合)
    v_token := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
    INSERT INTO public.user_calendar_tokens (user_id, token)
      VALUES (v_user_id, v_token);
  END IF;

  RETURN v_token;
END;
$$;

-- token を再発行 (漏洩時用)
CREATE OR REPLACE FUNCTION public.rotate_user_calendar_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_token TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_token := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');

  INSERT INTO public.user_calendar_tokens (user_id, token, created_at, last_accessed_at)
    VALUES (v_user_id, v_token, NOW(), NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET token = EXCLUDED.token,
          created_at = EXCLUDED.created_at,
          last_accessed_at = NULL;

  RETURN v_token;
END;
$$;

-- token から該当ユーザの予定一覧を取得 (作成者 OR attendee)。
-- API route から service-role で呼ばれる想定だが、関数内で token 検証するため
-- どのロールから呼んでも漏れない。VOLATILE 必須 (last_accessed_at を更新するため)。
CREATE OR REPLACE FUNCTION public.get_events_by_calendar_token(
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_user_id
    FROM public.user_calendar_tokens
   WHERE token = p_token;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- アクセス時刻を更新 (デバッグ用 / 利用状況把握のため)
  UPDATE public.user_calendar_tokens
     SET last_accessed_at = NOW()
   WHERE user_id = v_user_id;

  SELECT json_agg(ev ORDER BY ev.start_at ASC)
    INTO v_result
  FROM (
    SELECT
      e.id,
      e.title,
      e.start_at,
      e.location,
      e.created_at,
      ch.name AS channel_name,
      p.display_name AS creator_name
    FROM public.events e
    LEFT JOIN public.channels ch ON ch.id = e.channel_id
    JOIN public.profiles p ON p.id = e.created_by
    WHERE (
      e.created_by = v_user_id
      OR v_user_id = ANY(e.attendee_ids)
    )
  ) ev;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- 各関数のオーナーを postgres にして RLS バイパスを確実にする
ALTER FUNCTION public.ensure_user_calendar_token() OWNER TO postgres;
ALTER FUNCTION public.rotate_user_calendar_token() OWNER TO postgres;
ALTER FUNCTION public.get_events_by_calendar_token(TEXT) OWNER TO postgres;
