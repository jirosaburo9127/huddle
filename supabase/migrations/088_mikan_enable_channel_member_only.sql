-- みかん enable/disable の権限を「ワークスペースメンバー全員」から
-- 「そのチャンネルのメンバーのみ」に絞る。
--
-- 旧 (066): workspace_members チェック → 興味本位で他人のチャンネルを ON/OFF できた
-- 新     : channel_members チェック   → 自分が参加しているチャンネルだけ操作可能

CREATE OR REPLACE FUNCTION public.set_mikan_enabled(
  p_channel_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 該当チャンネルのメンバーであることを確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.channels SET mikan_enabled = p_enabled WHERE id = p_channel_id;
END;
$$;
