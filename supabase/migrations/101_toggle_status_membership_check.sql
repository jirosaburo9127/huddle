-- toggle_message_status の認可チェック強化。
-- 旧版は p_message_id を受け取って auth.uid() の存在だけ見ており、
-- 該当メッセージのチャンネルに対する所属チェックがなかったため、
-- message_id さえ知っていれば別 workspace の他人の投稿の status まで
-- 書き換えられる状態だった。
-- 修正: メッセージのチャンネルを引き、その channel_members に呼び出し
-- ユーザが含まれているかを確認してから更新する。

CREATE OR REPLACE FUNCTION public.toggle_message_status(
  p_message_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_channel_id uuid;
  v_current text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('in_progress', 'done') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT m.channel_id, m.status
    INTO v_channel_id, v_current
    FROM public.messages m
   WHERE m.id = p_message_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
     WHERE channel_id = v_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  -- 同じステータスなら null に戻す (トグル)
  IF v_current = p_status THEN
    UPDATE public.messages SET status = NULL WHERE id = p_message_id;
  ELSE
    UPDATE public.messages SET status = p_status WHERE id = p_message_id;
  END IF;
END;
$$;
