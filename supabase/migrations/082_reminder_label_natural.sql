-- リマインド本文のラベルを自然な日本語表現に変更
-- 旧: 「⏰ 1日前リマインド: 「タイトル」/ 5月20日(水) 08:00」
-- 新: 「⏰ 明日の予定です / 「タイトル」/ 5月20日(水) 08:00」
--
-- マッピング:
--   1440分 (1日前)   → 「明日の予定です」
--   2880分 (2日前)   → 「明後日の予定です」
--   N*1440 (N日前)   → 「N日後の予定です」
--   60分  (1時間前)  → 「1時間後の予定です」
--   N時間 (N時間前)  → 「N時間後の予定です」
--   N分              → 「N分後の予定です」

CREATE OR REPLACE FUNCTION public.fire_event_reminders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_row RECORD;
  v_loc_line TEXT;
  v_kind_label TEXT;
  v_content TEXT;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT e.id, e.channel_id, e.title, e.start_at, e.location,
           UNNEST(e.reminder_offsets) AS offset_min
    FROM public.events e
    WHERE e.channel_id IS NOT NULL
      AND e.start_at > NOW()
      AND e.reminder_offsets IS NOT NULL
      AND array_length(e.reminder_offsets, 1) > 0
  LOOP
    -- 既発火スキップ
    IF EXISTS (
      SELECT 1 FROM public.event_reminder_fires
      WHERE event_id = v_row.id AND offset_minutes = v_row.offset_min
    ) THEN
      CONTINUE;
    END IF;

    -- catch-up 15 分以内
    IF NOT (
      v_row.start_at - (v_row.offset_min * INTERVAL '1 minute')
        BETWEEN NOW() - INTERVAL '15 minutes' AND NOW()
    ) THEN
      CONTINUE;
    END IF;

    -- 自然な日本語ラベル
    v_kind_label := CASE
      WHEN v_row.offset_min = 1440 THEN '明日の予定です'
      WHEN v_row.offset_min = 2880 THEN '明後日の予定です'
      WHEN v_row.offset_min >= 1440 AND v_row.offset_min % 1440 = 0
        THEN (v_row.offset_min / 1440)::TEXT || '日後の予定です'
      WHEN v_row.offset_min >= 60 AND v_row.offset_min % 60 = 0
        THEN (v_row.offset_min / 60)::TEXT || '時間後の予定です'
      ELSE v_row.offset_min::TEXT || '分後の予定です'
    END;

    IF v_row.location IS NOT NULL AND length(btrim(v_row.location)) > 0 THEN
      v_loc_line := E'\n📍 ' || v_row.location;
    ELSE
      v_loc_line := '';
    END IF;

    -- 例: ⏰ 明日の予定です\n「打合せ」\n5月20日(水) 08:00\n📍 会議室
    v_content := format(
      E'⏰ %s\n「%s」\n%s%s',
      v_kind_label,
      v_row.title,
      public._format_dt_ja(v_row.start_at),
      v_loc_line
    );

    INSERT INTO public.messages (channel_id, user_id, content)
      VALUES (v_row.channel_id, v_mikan_id, v_content);

    INSERT INTO public.event_reminder_fires (event_id, offset_minutes)
      VALUES (v_row.id, v_row.offset_min);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
