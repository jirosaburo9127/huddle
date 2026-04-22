-- イベント編集機能

-- UPDATE RLSポリシー: 作成者のみ編集可
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- イベント更新RPC
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

  UPDATE public.events
  SET title = btrim(p_title),
      start_at = p_start_at,
      location = p_location,
      attendee_ids = p_attendee_ids
  WHERE id = p_event_id AND created_by = v_user_id
  RETURNING * INTO v_event;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'event not found or not authorized';
  END IF;

  -- メッセージ本文も更新
  UPDATE public.messages
  SET content = '📅 ' || btrim(p_title) || E'\n' ||
    to_char(p_start_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') ||
    CASE WHEN p_location IS NOT NULL AND p_location <> '' THEN E'\n📍 ' || p_location ELSE '' END,
    edited_at = NOW()
  WHERE id = v_event.message_id;

  RETURN row_to_json(v_event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_event(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]) TO authenticated;
