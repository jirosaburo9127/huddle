-- 個人予定 (channel_id NULL) を後からチャンネルに紐付ける RPC
-- 1) 作成者本人のみ操作可
-- 2) 既にチャンネル紐付け済みの予定には使えない (誤って既存の channel_id を上書きしないため)
-- 3) 対象チャンネルのメンバーであることを確認
-- 4) 受け取った message_id を events.message_id に紐づける (クライアント側で先に
--    該当チャンネルへ「📅 ...」メッセージを insert してから本 RPC を呼ぶ想定)

CREATE OR REPLACE FUNCTION public.link_event_to_channel(
  p_event_id UUID,
  p_channel_id UUID,
  p_message_id UUID
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

  -- 個人予定で作成者本人のものか確認
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = p_event_id
      AND created_by = v_user_id
      AND channel_id IS NULL
  ) THEN
    RAISE EXCEPTION 'event not found or already linked';
  END IF;

  -- 紐付け先チャンネルのメンバーシップ確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  -- 紐付け
  UPDATE public.events
  SET channel_id = p_channel_id, message_id = p_message_id
  WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_event_to_channel(UUID, UUID, UUID) TO authenticated;
