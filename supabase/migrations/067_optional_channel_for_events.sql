-- 個人予定 (チャンネル紐付けなし) を許容するために events を nullable に拡張
-- channel_id NULL = 個人予定 (作成者のみ閲覧・削除可)
-- message_id NULL = チャンネル投稿に紐づかない予定 (個人予定や、後でチャンネルに紐付けする予定)

-- ============================================================================
-- 1) NOT NULL 制約を緩める
-- ============================================================================
ALTER TABLE public.events
  ALTER COLUMN channel_id DROP NOT NULL,
  ALTER COLUMN message_id DROP NOT NULL;

-- ============================================================================
-- 2) RLS ポリシーを再定義: channel_id NULL の場合は created_by 基準
-- ============================================================================
DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT USING (
    -- 個人予定: 作成者のみ閲覧
    (channel_id IS NULL AND created_by = auth.uid())
    OR
    -- チャンネル予定: チャンネルメンバーなら閲覧
    (channel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = events.channel_id AND user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT WITH CHECK (
    -- 個人予定: 自分自身が作成者なら OK
    (channel_id IS NULL AND created_by = auth.uid())
    OR
    -- チャンネル予定: チャンネルメンバーなら OK
    (channel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = events.channel_id AND user_id = auth.uid()
    ))
  );

-- DELETE は元の「作成者のみ」を維持

-- UPDATE: 作成者のみ編集可 (個人予定 → チャンネル紐付けなど)
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (created_by = auth.uid());

-- ============================================================================
-- 3) create_event RPC を更新: p_channel_id / p_message_id を任意に
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- チャンネル指定がある場合のみメンバーシップチェック
  IF p_channel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = p_channel_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'not a channel member';
    END IF;
  END IF;

  -- タイトルバリデーション
  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title is empty';
  END IF;

  -- イベント挿入 (channel_id / message_id ともに NULL 許容)
  INSERT INTO public.events (message_id, channel_id, created_by, title, start_at, location, attendee_ids)
  VALUES (p_message_id, p_channel_id, v_user_id, btrim(p_title), p_start_at, p_location, p_attendee_ids)
  RETURNING * INTO v_event;

  RETURN row_to_json(v_event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]) TO authenticated;

-- ============================================================================
-- 4) get_workspace_events を更新: 個人予定も含める
--    JOIN を LEFT JOIN にして channel が NULL でも取得、メンバーシップ判定も拡張
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_workspace_events(
  p_workspace_slug TEXT,
  p_user_id UUID,
  p_year INT,
  p_month INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id UUID;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- workspace_id を解決
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end := v_start + INTERVAL '1 month';

  SELECT json_agg(ev ORDER BY ev.start_at ASC)
  INTO v_result
  FROM (
    SELECT
      e.id,
      e.message_id,
      e.channel_id,
      e.created_by,
      e.title,
      e.start_at,
      e.location,
      e.attendee_ids,
      e.created_at,
      -- channel が NULL なら null
      CASE WHEN ch.id IS NOT NULL
        THEN json_build_object('id', ch.id, 'name', ch.name, 'slug', ch.slug)
        ELSE NULL
      END AS channel,
      json_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url
      ) AS creator,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', ap.id,
            'display_name', ap.display_name,
            'avatar_url', ap.avatar_url
          )
        ), '[]'::json)
        FROM public.profiles ap
        WHERE ap.id = ANY(e.attendee_ids)
      ) AS attendees
    FROM public.events e
    LEFT JOIN public.channels ch ON ch.id = e.channel_id
    JOIN public.profiles p ON p.id = e.created_by
    WHERE e.start_at >= v_start
      AND e.start_at < v_end
      AND (
        -- 個人予定: 作成者本人
        (e.channel_id IS NULL AND e.created_by = p_user_id)
        OR
        -- チャンネル予定: 指定 workspace 内のチャンネルでメンバー
        (
          e.channel_id IS NOT NULL
          AND ch.workspace_id = v_workspace_id
          AND EXISTS (
            SELECT 1 FROM public.channel_members cm
            WHERE cm.channel_id = e.channel_id AND cm.user_id = p_user_id
          )
        )
      )
  ) ev;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_events(TEXT, UUID, INT, INT) TO authenticated;
