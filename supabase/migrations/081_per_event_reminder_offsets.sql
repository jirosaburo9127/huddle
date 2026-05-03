-- リマインドオフセットを「グローバル固定」から「イベント単位で持つ」設計に変更。
-- (a) events.reminder_offsets を追加。デフォルトは {1440} (= 1 日前)
-- (b) create_event RPC で lead time が短ければ適切なデフォルトに自動切替
--     - 1日 超          → {1440}
--     - 1時間〜1日       → {60}
--     - 10分〜1時間      → {10}
--     - 10分以下         → {} (リマインド無し)
-- (c) handle_event_proposal_reaction も同じロジックに合わせる
-- (d) fire_event_reminders は events.reminder_offsets を unnest して走査

-- ============================================================================
-- (a) reminder_offsets カラム追加
-- ============================================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_offsets INT[] NOT NULL DEFAULT ARRAY[1440];

-- ============================================================================
-- (b) create_event RPC 更新
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_event(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]);

CREATE OR REPLACE FUNCTION public.create_event(
  p_message_id UUID,
  p_channel_id UUID,
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
  v_delta_min NUMERIC;
  v_offsets INT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_channel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = p_channel_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'not a channel member';
    END IF;
  END IF;

  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title is empty';
  END IF;

  -- lead time に応じてリマインドのデフォルトを決める
  v_delta_min := EXTRACT(EPOCH FROM (p_start_at - NOW())) / 60.0;
  v_offsets := CASE
    WHEN v_delta_min > 1440 THEN ARRAY[1440]
    WHEN v_delta_min > 60   THEN ARRAY[60]
    WHEN v_delta_min > 10   THEN ARRAY[10]
    ELSE ARRAY[]::INT[]
  END;

  INSERT INTO public.events (
    message_id, channel_id, created_by, title, start_at, location, attendee_ids, reminder_offsets
  )
  VALUES (
    p_message_id, p_channel_id, v_user_id, btrim(p_title), p_start_at, p_location, p_attendee_ids, v_offsets
  )
  RETURNING * INTO v_event;

  RETURN row_to_json(v_event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]) TO authenticated;

-- ============================================================================
-- (c) handle_event_proposal_reaction 更新 (mikan 確定経路にも同じロジック)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_event_proposal_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal RECORD;
  v_event_msg_id UUID;
  v_event_id UUID;
  v_loc_line TEXT;
  v_event_msg_content TEXT;
  v_is_member BOOLEAN;
  v_delta_min NUMERIC;
  v_offsets INT[];
BEGIN
  SELECT * INTO v_proposal FROM public.event_proposals
    WHERE message_id = NEW.message_id AND status = 'pending';
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_proposal.channel_id AND user_id = NEW.user_id
  ) INTO v_is_member;
  IF NOT v_is_member THEN RETURN NEW; END IF;

  IF v_proposal.expires_at < NOW() THEN
    UPDATE public.event_proposals SET status = 'expired' WHERE id = v_proposal.id;
    RETURN NEW;
  END IF;

  IF v_proposal.location IS NOT NULL AND length(btrim(v_proposal.location)) > 0 THEN
    v_loc_line := E'\n📍 ' || v_proposal.location;
  ELSE
    v_loc_line := '';
  END IF;
  v_event_msg_content := format(
    E'📅 %s\n%s%s',
    v_proposal.title,
    public._format_dt_ja(v_proposal.starts_at),
    v_loc_line
  );

  INSERT INTO public.messages (channel_id, user_id, content)
    VALUES (v_proposal.channel_id, v_proposal.proposed_by, v_event_msg_content)
    RETURNING id INTO v_event_msg_id;

  v_delta_min := EXTRACT(EPOCH FROM (v_proposal.starts_at - NOW())) / 60.0;
  v_offsets := CASE
    WHEN v_delta_min > 1440 THEN ARRAY[1440]
    WHEN v_delta_min > 60   THEN ARRAY[60]
    WHEN v_delta_min > 10   THEN ARRAY[10]
    ELSE ARRAY[]::INT[]
  END;

  INSERT INTO public.events (
    message_id, channel_id, created_by, title, start_at, location, attendee_ids, reminder_offsets
  ) VALUES (
    v_event_msg_id,
    v_proposal.channel_id,
    NEW.user_id,
    v_proposal.title,
    v_proposal.starts_at,
    v_proposal.location,
    '{}',
    v_offsets
  )
  RETURNING id INTO v_event_id;

  UPDATE public.event_proposals
    SET status = 'confirmed', confirmed_event_id = v_event_id
    WHERE id = v_proposal.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_event_proposal_reaction failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- (d) fire_event_reminders を per-event オフセット対応に
-- ============================================================================
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
    -- 既に発火済みならスキップ
    IF EXISTS (
      SELECT 1 FROM public.event_reminder_fires
      WHERE event_id = v_row.id AND offset_minutes = v_row.offset_min
    ) THEN
      CONTINUE;
    END IF;

    -- 発火タイミングチェック (catch-up 15 分)
    IF NOT (
      v_row.start_at - (v_row.offset_min * INTERVAL '1 minute')
        BETWEEN NOW() - INTERVAL '15 minutes' AND NOW()
    ) THEN
      CONTINUE;
    END IF;

    -- ラベル組み立て
    IF v_row.offset_min >= 1440 AND v_row.offset_min % 1440 = 0 THEN
      v_kind_label := (v_row.offset_min / 1440)::TEXT || '日前';
    ELSIF v_row.offset_min >= 60 AND v_row.offset_min % 60 = 0 THEN
      v_kind_label := (v_row.offset_min / 60)::TEXT || '時間前';
    ELSE
      v_kind_label := v_row.offset_min::TEXT || '分前';
    END IF;

    IF v_row.location IS NOT NULL AND length(btrim(v_row.location)) > 0 THEN
      v_loc_line := E'\n📍 ' || v_row.location;
    ELSE
      v_loc_line := '';
    END IF;

    v_content := format(
      E'⏰ %sリマインド: 「%s」\n%s%s',
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
