-- mark_channel_read を「更新後の last_read_at を返す」形に変更。
-- これで呼び出し側 (ChannelView) が確定したサーバ時刻を取得でき、
-- Sidebar / 未読ライン / バッジが同じ真実を共有できるようになる。

-- 既存は RETURNS VOID なので、戻り型変更にはまず DROP が必要
DROP FUNCTION IF EXISTS public.mark_channel_read(uuid);

CREATE OR REPLACE FUNCTION public.mark_channel_read(p_channel_id UUID)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_last_read_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.channel_members
  SET last_read_at = now()
  WHERE channel_id = p_channel_id
    AND user_id = v_user_id
  RETURNING last_read_at INTO v_new_last_read_at;

  RETURN v_new_last_read_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_read(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
