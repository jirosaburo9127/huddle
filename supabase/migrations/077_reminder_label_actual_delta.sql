-- リマインド本文のラベルを「offset 値ベース」から「実時間 (event 開始までの差分) ベース」に変更。
-- 76 では catch-up ウィンドウで 1h-offset がマッチしただけで「1時間後」と固定表記していたため、
-- 実際は 5 分後の event でもメッセージが「1時間後」になっていた。

CREATE OR REPLACE FUNCTION public.fire_event_reminders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_offsets INT[] := ARRAY[1440, 60]; -- 1 日前 + 1 時間前
  v_offset INT;
  v_event RECORD;
  v_loc_line TEXT;
  v_content TEXT;
  v_minutes_left NUMERIC;
  v_label TEXT;
  v_count INT := 0;
BEGIN
  FOREACH v_offset IN ARRAY v_offsets LOOP
    FOR v_event IN
      SELECT e.id, e.channel_id, e.title, e.start_at, e.location
      FROM public.events e
      LEFT JOIN public.event_reminder_fires f
        ON f.event_id = e.id AND f.offset_minutes = v_offset
      WHERE e.channel_id IS NOT NULL
        AND e.start_at > NOW()
        AND e.start_at - (v_offset * INTERVAL '1 minute')
            BETWEEN NOW() - INTERVAL '1 hour' AND NOW()
        AND f.id IS NULL
    LOOP
      -- 実際に開始まで何分か
      v_minutes_left := EXTRACT(EPOCH FROM (v_event.start_at - NOW())) / 60.0;

      IF v_minutes_left < 1 THEN
        v_label := 'まもなく';
      ELSIF v_minutes_left < 60 THEN
        v_label := round(v_minutes_left)::TEXT || '分後';
      ELSIF v_minutes_left < 1440 THEN
        v_label := round(v_minutes_left / 60.0)::TEXT || '時間後';
      ELSE
        v_label := round(v_minutes_left / 1440.0)::TEXT || '日後';
      END IF;

      IF v_event.location IS NOT NULL AND length(btrim(v_event.location)) > 0 THEN
        v_loc_line := E'\n📍 ' || v_event.location;
      ELSE
        v_loc_line := '';
      END IF;

      v_content := format(
        E'⏰ リマインド: 「%s」が%sに始まります\n%s%s',
        v_event.title,
        v_label,
        public._format_dt_ja(v_event.start_at),
        v_loc_line
      );

      INSERT INTO public.messages (channel_id, user_id, content)
        VALUES (v_event.channel_id, v_mikan_id, v_content);

      INSERT INTO public.event_reminder_fires (event_id, offset_minutes)
        VALUES (v_event.id, v_offset);

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;
