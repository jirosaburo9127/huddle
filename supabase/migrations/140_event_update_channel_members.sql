-- チャンネル予定はチャンネルメンバー全員が編集できるようにする
-- 個人予定 (channel_id IS NULL) は従来どおり作成者本人のみ編集可

-- ============================================================================
-- 1) UPDATE RLS ポリシー: 個人予定=作成者 / チャンネル予定=メンバー
-- ============================================================================
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (
    -- 個人予定: 作成者本人のみ
    (channel_id IS NULL AND created_by = auth.uid())
    OR
    -- チャンネル予定: チャンネルメンバーなら誰でも
    (channel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = events.channel_id AND user_id = auth.uid()
    ))
  );

-- ============================================================================
-- 2) update_event RPC: 権限判定をメンバーシップ基準に拡張
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_event(
  p_event_id UUID,
  p_title TEXT,
  p_start_at TIMESTAMPTZ,
  p_location TEXT DEFAULT NULL,
  p_attendee_ids UUID[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event public.events;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 対象イベントを取得
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  -- 権限チェック
  IF v_event.channel_id IS NULL THEN
    -- 個人予定: 作成者本人のみ
    IF v_event.created_by <> v_user_id THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    -- チャンネル予定: そのチャンネルのメンバーなら誰でも編集可
    IF NOT EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = v_event.channel_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'not a channel member';
    END IF;
  END IF;

  -- タイトルバリデーション
  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title is empty';
  END IF;

  UPDATE public.events
  SET title = btrim(p_title),
      start_at = p_start_at,
      location = p_location,
      attendee_ids = p_attendee_ids
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  -- メッセージ本文も更新 (チャンネル予定で message_id がある場合のみ)
  IF v_event.message_id IS NOT NULL THEN
    UPDATE public.messages
    SET content = '📅 ' || btrim(p_title) || E'\n' ||
      to_char(p_start_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') ||
      CASE WHEN p_location IS NOT NULL AND p_location <> '' THEN E'\n📍 ' || p_location ELSE '' END,
      edited_at = NOW()
    WHERE id = v_event.message_id;
  END IF;

  RETURN row_to_json(v_event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_event(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]) TO authenticated;
