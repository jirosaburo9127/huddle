-- リマインド本文のラベルを「投稿時点の残り時間」から「リマインドの種類 (offset 名)」に変更。
-- 旧版は「6分後に始まります」のように相対時間を本文に焼き込んでいたが、
-- 読まれる時点とのズレで「時間がずれてる」と誤解される。
-- 新版は「10分前リマインド」のように「これは何分前リマインドか」だけ示し、
-- 絶対時刻で開始日時を伝える。

CREATE OR REPLACE FUNCTION public.fire_event_reminders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_offsets INT[] := ARRAY[1440, 60, 10];
  v_offset INT;
  v_event RECORD;
  v_loc_line TEXT;
  v_content TEXT;
  v_kind_label TEXT;
  v_count INT := 0;
BEGIN
  FOREACH v_offset IN ARRAY v_offsets LOOP
    -- offset の名前 (= リマインドの種類)
    IF v_offset >= 1440 AND v_offset % 1440 = 0 THEN
      v_kind_label := (v_offset / 1440)::TEXT || '日前';
    ELSIF v_offset >= 60 AND v_offset % 60 = 0 THEN
      v_kind_label := (v_offset / 60)::TEXT || '時間前';
    ELSE
      v_kind_label := v_offset::TEXT || '分前';
    END IF;

    FOR v_event IN
      SELECT e.id, e.channel_id, e.title, e.start_at, e.location
      FROM public.events e
      LEFT JOIN public.event_reminder_fires f
        ON f.event_id = e.id AND f.offset_minutes = v_offset
      WHERE e.channel_id IS NOT NULL
        AND e.start_at > NOW()
        AND e.start_at - (v_offset * INTERVAL '1 minute')
            BETWEEN NOW() - INTERVAL '15 minutes' AND NOW()
        AND f.id IS NULL
    LOOP
      IF v_event.location IS NOT NULL AND length(btrim(v_event.location)) > 0 THEN
        v_loc_line := E'\n📍 ' || v_event.location;
      ELSE
        v_loc_line := '';
      END IF;

      -- 例: "⏰ 10分前リマインド: 「打合せ」\n5月4日(月) 03:09\n📍 会議室"
      v_content := format(
        E'⏰ %sリマインド: 「%s」\n%s%s',
        v_kind_label,
        v_event.title,
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
