-- 投票機能
-- 1メッセージに 1 つの投票を紐づける。メッセージ本文が質問文、
-- polls.options が選択肢配列、poll_votes が個々の投票。
-- チャンネルメンバーのみ作成・投票・閉鎖可能。

CREATE TABLE IF NOT EXISTS public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  options JSONB NOT NULL, -- 文字列配列: ["選択肢1", "選択肢2", ...]
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polls_channel ON public.polls(channel_id);
CREATE INDEX IF NOT EXISTS idx_polls_message ON public.polls(message_id);

CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  option_index INT NOT NULL, -- polls.options 配列のインデックス
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(poll_id, user_id, option_index)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON public.poll_votes(poll_id);

-- RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- polls: チャンネルメンバーなら閲覧可
DROP POLICY IF EXISTS "polls_select" ON public.polls;
CREATE POLICY "polls_select" ON public.polls
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = polls.channel_id AND user_id = auth.uid()
    )
  );

-- poll_votes: チャンネルメンバーなら閲覧可
DROP POLICY IF EXISTS "poll_votes_select" ON public.poll_votes;
CREATE POLICY "poll_votes_select" ON public.poll_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      JOIN public.channel_members cm ON cm.channel_id = p.channel_id
      WHERE p.id = poll_votes.poll_id AND cm.user_id = auth.uid()
    )
  );

-- ==========================================
-- 投票作成 RPC
-- messages 挿入と polls 挿入を 1 トランザクションで行う
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_poll(
  p_channel_id UUID,
  p_question TEXT,
  p_options JSONB,
  p_allow_multiple BOOLEAN
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

  -- チャンネルメンバー確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  -- 選択肢は2〜6個
  IF jsonb_array_length(p_options) < 2 OR jsonb_array_length(p_options) > 6 THEN
    RAISE EXCEPTION 'poll must have 2 to 6 options';
  END IF;
  IF length(btrim(p_question)) = 0 THEN
    RAISE EXCEPTION 'question is empty';
  END IF;

  -- メッセージ挿入 (質問文を content に入れる)
  INSERT INTO public.messages (channel_id, user_id, content)
  VALUES (p_channel_id, v_user_id, btrim(p_question))
  RETURNING * INTO v_msg;

  -- polls 挿入
  INSERT INTO public.polls (message_id, channel_id, created_by, options, allow_multiple)
  VALUES (v_msg.id, p_channel_id, v_user_id, p_options, p_allow_multiple);

  RETURN v_msg;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_poll(UUID, TEXT, JSONB, BOOLEAN) TO authenticated;

-- ==========================================
-- 投票 RPC
-- 単一選択モードの場合は、同一ユーザーの既存票を削除してから挿入
-- ==========================================
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

  -- チャンネルメンバー確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_poll.channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  -- 既存の自分の票を全削除して入れ直し (単一・複数選択共通の単純な実装)
  DELETE FROM public.poll_votes
  WHERE poll_id = p_poll_id AND user_id = v_user_id;

  -- 単一選択モードなら先頭の 1 つだけ採用
  IF NOT v_poll.allow_multiple AND array_length(p_option_indices, 1) > 1 THEN
    INSERT INTO public.poll_votes (poll_id, user_id, option_index)
    VALUES (p_poll_id, v_user_id, p_option_indices[1]);
  ELSE
    FOREACH v_idx IN ARRAY p_option_indices LOOP
      -- 選択肢インデックスのバリデーション
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

-- ==========================================
-- 投票を閉じる RPC
-- ==========================================
CREATE OR REPLACE FUNCTION public.close_poll(p_poll_id UUID)
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

  SELECT channel_id INTO v_channel_id FROM public.polls WHERE id = p_poll_id;
  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'poll not found';
  END IF;

  -- チャンネルメンバーなら誰でも閉じれる
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.polls
  SET is_closed = TRUE, closed_at = NOW()
  WHERE id = p_poll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_poll(UUID) TO authenticated;

-- ==========================================
-- Realtime 配信を有効化
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;
