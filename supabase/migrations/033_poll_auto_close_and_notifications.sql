-- 投票自動クローズ + 投票/スレッド返信の通知インフラ
--
-- アプローチ:
-- - messages テーブルに system_event 列を追加 (poll_created / poll_closed)
-- - create_poll / close_poll / auto_close_expired_polls がそれぞれ
--   マーカー付きメッセージを INSERT することで既存の send-push を再利用
-- - pg_cron で期限切れ投票を自動クローズ
--
-- ポリシー上の注意:
-- system_event 付きメッセージも通常の messages_select / _insert を通るため
-- チャンネルメンバーしか見れない

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- messages テーブルにシステムイベントマーカーを追加
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS system_event TEXT;

-- ==========================================
-- 期限切れ投票を自動的に閉じる関数
-- close_poll の内部処理と同じだが、一括で適用する
-- ==========================================
CREATE OR REPLACE FUNCTION public.auto_close_expired_polls()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_msg_content TEXT;
BEGIN
  FOR r IN
    SELECT p.id, p.message_id, p.channel_id, p.created_by, m.content AS question
    FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
    WHERE p.is_closed = FALSE
      AND p.closes_at IS NOT NULL
      AND p.closes_at <= NOW()
  LOOP
    UPDATE public.polls
    SET is_closed = TRUE, closed_at = NOW()
    WHERE id = r.id;

    -- システムメッセージを作成者名義で作る (送信者は作成者)
    v_msg_content := '📊 投票が締め切られました: ' || r.question;
    INSERT INTO public.messages (channel_id, user_id, content, system_event)
    VALUES (r.channel_id, r.created_by, v_msg_content, 'poll_closed');
  END LOOP;
END;
$$;

-- 1分ごとに自動クローズを実行
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-expired-polls') THEN
    PERFORM cron.schedule(
      'auto-close-expired-polls',
      '* * * * *',
      $cron$SELECT public.auto_close_expired_polls()$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, skipping schedule: %', SQLERRM;
END $$;

-- ==========================================
-- close_poll RPC を拡張: 手動クローズ時もシステムメッセージを作る
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
  v_question TEXT;
  v_is_closed BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT p.channel_id, m.content, p.is_closed
    INTO v_channel_id, v_question, v_is_closed
  FROM public.polls p
  JOIN public.messages m ON m.id = p.message_id
  WHERE p.id = p_poll_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'poll not found';
  END IF;
  IF v_is_closed THEN
    RETURN; -- 既に閉じている場合は何もしない
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.polls
  SET is_closed = TRUE, closed_at = NOW()
  WHERE id = p_poll_id;

  -- 締切メッセージを挿入 (通知経由で全員に届く)
  INSERT INTO public.messages (channel_id, user_id, content, system_event)
  VALUES (
    v_channel_id,
    v_user_id,
    '📊 投票が締め切られました: ' || v_question,
    'poll_closed'
  );
END;
$$;

-- ==========================================
-- create_poll RPC を拡張: 投票作成メッセージに system_event='poll_created'
-- ==========================================
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

  INSERT INTO public.messages (channel_id, user_id, content, system_event)
  VALUES (p_channel_id, v_user_id, btrim(p_question), 'poll_created')
  RETURNING * INTO v_msg;

  INSERT INTO public.polls (message_id, channel_id, created_by, options, allow_multiple, closes_at)
  VALUES (v_msg.id, p_channel_id, v_user_id, p_options, p_allow_multiple, p_closes_at);

  RETURN v_msg;
END;
$$;
