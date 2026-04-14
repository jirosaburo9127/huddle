-- クライアントのローカル時刻に依存せず、サーバ側の now() で
-- last_read_at を更新するための RPC
-- クライアント時計のズレで既読マークが新着メッセージより古くなり、
-- バッジが残り続ける問題の修正。

CREATE OR REPLACE FUNCTION public.mark_channel_read(p_channel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- サーバ now() で既読タイムスタンプを確定
  UPDATE public.channel_members
  SET last_read_at = now()
  WHERE channel_id = p_channel_id
    AND user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_read(UUID) TO authenticated;
