-- 投票に締切 (closes_at) を追加
-- closes_at が過ぎたら UI 側で自動的に閉じ扱いにする。

ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;

-- create_poll RPC に締切パラメータを追加
CREATE OR REPLACE FUNCTION public.create_poll(
  p_channel_id UUID,
  p_question TEXT,
  p_options JSONB,
  p_allow_multiple BOOLEAN,
  p_closes_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_msg public.messages;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  IF jsonb_array_length(p_options) < 2 OR jsonb_array_length(p_options) > 6 THEN
    RAISE EXCEPTION 'poll must have 2 to 6 options';
  END IF;
  IF length(btrim(p_question)) = 0 THEN
    RAISE EXCEPTION 'question is empty';
  END IF;
  IF p_closes_at IS NOT NULL AND p_closes_at <= NOW() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  INSERT INTO public.messages (channel_id, user_id, content)
  VALUES (p_channel_id, v_user_id, btrim(p_question))
  RETURNING * INTO v_msg;

  INSERT INTO public.polls (message_id, channel_id, created_by, options, allow_multiple, closes_at)
  VALUES (v_msg.id, p_channel_id, v_user_id, p_options, p_allow_multiple, p_closes_at);

  RETURN v_msg;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_poll(UUID, TEXT, JSONB, BOOLEAN, TIMESTAMPTZ) TO authenticated;

-- cast_poll_vote: 締切を過ぎていたら受け付けない
CREATE OR REPLACE FUNCTION public.cast_poll_vote(
  p_poll_id UUID,
  p_option_indices INT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_poll public.polls;
  v_idx INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_poll FROM public.polls WHERE id = p_poll_id;
  IF v_poll.id IS NULL THEN
    RAISE EXCEPTION 'poll not found';
  END IF;

  IF v_poll.is_closed THEN
    RAISE EXCEPTION 'poll is closed';
  END IF;

  -- 締切を過ぎていたら受け付けない
  IF v_poll.closes_at IS NOT NULL AND v_poll.closes_at <= NOW() THEN
    RAISE EXCEPTION 'poll is past deadline';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_poll.channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  DELETE FROM public.poll_votes
  WHERE poll_id = p_poll_id AND user_id = v_user_id;

  IF NOT v_poll.allow_multiple AND array_length(p_option_indices, 1) > 1 THEN
    INSERT INTO public.poll_votes (poll_id, user_id, option_index)
    VALUES (p_poll_id, v_user_id, p_option_indices[1]);
  ELSE
    FOREACH v_idx IN ARRAY p_option_indices LOOP
      IF v_idx < 0 OR v_idx >= jsonb_array_length(v_poll.options) THEN
        CONTINUE;
      END IF;
      INSERT INTO public.poll_votes (poll_id, user_id, option_index)
      VALUES (p_poll_id, v_user_id, v_idx)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_poll_vote(UUID, INT[]) TO authenticated;
