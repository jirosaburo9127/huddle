-- みかんの整理機能（mikan-organize）の回数上限と「前回どこまで読んだか」の記録
--
-- AI の利用料を固定するため、1人1日の回数と全体の月間回数に上限をかける。
-- 上限の数字は Edge Function 側の定数で持ち、ここでは引数で受け取る。
-- どちらのテーブルも Edge Function（service role）からだけ触る。
-- RLS を有効にしてポリシーを作らないことで、画面側からは読み書きできないようにする。

CREATE TABLE IF NOT EXISTS public.mikan_usage (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 日本時間の日付
  used_on DATE NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_on)
);
CREATE INDEX IF NOT EXISTS mikan_usage_used_on_idx ON public.mikan_usage (used_on);
ALTER TABLE public.mikan_usage ENABLE ROW LEVEL SECURITY;

-- 前回 AI に読ませた時刻。次回はこれより後の投稿だけを送る
CREATE TABLE IF NOT EXISTS public.mikan_scan_state (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 読む範囲: チャンネルなら "ch:<id>"、参加チャンネル全部なら "ws:<id>"
  scope TEXT NOT NULL,
  -- 何を拾うか: my_tasks / week_events / all
  mode TEXT NOT NULL,
  last_scanned_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, scope, mode)
);
ALTER TABLE public.mikan_scan_state ENABLE ROW LEVEL SECURITY;

-- 上限の確認と加算を1回で行う（同時に押されてもすり抜けないよう、全体を直列にする）。
-- p_consume = false のときは数えずに残り回数だけ返す。
-- 返り値: { ok, reason: null | 'daily' | 'monthly', remaining: 今日の残り回数 }
CREATE OR REPLACE FUNCTION public.mikan_quota(
  p_user_id UUID,
  p_daily_limit INTEGER,
  p_monthly_limit INTEGER,
  p_consume BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_month_start DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::date;
  v_month INTEGER;
  v_day INTEGER;
BEGIN
  IF p_consume THEN
    PERFORM pg_advisory_xact_lock(hashtext('mikan_quota'));
  END IF;

  SELECT COALESCE(SUM(used_count), 0) INTO v_month
    FROM mikan_usage WHERE used_on >= v_month_start;
  SELECT COALESCE(SUM(used_count), 0) INTO v_day
    FROM mikan_usage WHERE user_id = p_user_id AND used_on = v_today;

  IF v_month >= p_monthly_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'monthly', 'remaining', GREATEST(p_daily_limit - v_day, 0));
  END IF;
  IF v_day >= p_daily_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily', 'remaining', 0);
  END IF;

  IF p_consume THEN
    INSERT INTO mikan_usage (user_id, used_on, used_count)
    VALUES (p_user_id, v_today, 1)
    ON CONFLICT (user_id, used_on) DO UPDATE SET used_count = mikan_usage.used_count + 1;
    v_day := v_day + 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'remaining', GREATEST(p_daily_limit - v_day, 0));
END;
$$;

-- AI の呼び出しに失敗したとき、数えた1回を戻す
CREATE OR REPLACE FUNCTION public.mikan_quota_refund(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE mikan_usage
     SET used_count = GREATEST(used_count - 1, 0)
   WHERE user_id = p_user_id
     AND used_on = (now() AT TIME ZONE 'Asia/Tokyo')::date;
END;
$$;

-- 画面側（anon / authenticated）からは呼べないようにする
REVOKE ALL ON FUNCTION public.mikan_quota(UUID, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mikan_quota_refund(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mikan_quota(UUID, INTEGER, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.mikan_quota_refund(UUID) TO service_role;
