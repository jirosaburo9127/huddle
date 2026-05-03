-- イベントの自動リマインド機能 (Phase 2)
-- ・1 日前 + 1 時間前 の 2 回、みかん bot がチャンネルに「⏰ リマインド」メッセージを投稿
-- ・既存の send-push-on-message webhook が messages INSERT を捕まえてチャンネル
--   メンバー全員に push 通知 → ユーザー要望「push 通知 + チャンネル投稿の両方」を満たす
-- ・pg_cron で 5 分おきにスキャン。重複発火防止に event_reminder_fires に記録
-- ・チャンネル付きイベントのみ対象 (個人予定は将来対応)

-- ============================================================================
-- 1) 発火履歴テーブル
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_reminder_fires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  offset_minutes INT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, offset_minutes)
);

CREATE INDEX IF NOT EXISTS idx_event_reminder_fires_event
  ON public.event_reminder_fires(event_id);

-- ============================================================================
-- 2) リマインド本文整形ヘルパー
--    1440 → "1日後", 60 → "1時間後", 30 → "30分後" のような表記を返す
-- ============================================================================
CREATE OR REPLACE FUNCTION public._format_offset_label(offset_min INT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_temp
AS $$
BEGIN
  IF offset_min >= 1440 AND offset_min % 1440 = 0 THEN
    RETURN (offset_min / 1440)::TEXT || '日後';
  ELSIF offset_min >= 60 AND offset_min % 60 = 0 THEN
    RETURN (offset_min / 60)::TEXT || '時間後';
  ELSE
    RETURN offset_min::TEXT || '分後';
  END IF;
END;
$$;

-- ============================================================================
-- 3) リマインド発火関数
--    catch-up ウィンドウ 1 時間: その間の未発火分はまとめて拾う
--    cron が 5 分間隔なので、最大でも開始時刻に対して 5 分以内の精度で発火する
-- ============================================================================
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
      IF v_event.location IS NOT NULL AND length(btrim(v_event.location)) > 0 THEN
        v_loc_line := E'\n📍 ' || v_event.location;
      ELSE
        v_loc_line := '';
      END IF;

      v_content := format(
        E'⏰ リマインド: 「%s」が%sに始まります\n%s%s',
        v_event.title,
        public._format_offset_label(v_offset),
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

-- ============================================================================
-- 4) pg_cron ジョブ登録 (5 分おき)
--    冪等にするため一度 unschedule してから schedule
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.unschedule('fire-event-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL; -- 未登録の場合は無視
END $$;

SELECT cron.schedule(
  'fire-event-reminders',
  '*/5 * * * *',
  $$SELECT public.fire_event_reminders()$$
);
