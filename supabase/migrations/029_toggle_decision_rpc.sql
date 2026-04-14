-- 決定事項マーカーを誰でも付け外しできるようにする RPC
-- 既存の messages_update RLS は著者のみに限定されているが、
-- 「決定事項」はチーム全体で運用する概念なので、
-- チャンネルメンバーなら誰でも決定マーク・Why/Due を操作できるようにする。

CREATE OR REPLACE FUNCTION public.toggle_decision(
  p_message_id UUID,
  p_is_decision BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_channel_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- メッセージの所属チャンネルを取得
  SELECT channel_id INTO v_channel_id
  FROM public.messages
  WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;

  -- チャンネルメンバーであることを確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.messages
  SET is_decision = p_is_decision
  WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_decision(UUID, BOOLEAN) TO authenticated;

-- Why / Due もチャンネルメンバーが誰でも編集できるように RPC 化
CREATE OR REPLACE FUNCTION public.update_decision_meta(
  p_message_id UUID,
  p_why TEXT,
  p_due TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_channel_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT channel_id INTO v_channel_id
  FROM public.messages
  WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.messages
  SET decision_why = p_why,
      decision_due = p_due
  WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_decision_meta(UUID, TEXT, TEXT) TO authenticated;
