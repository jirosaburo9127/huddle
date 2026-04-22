-- カレンダー／イベント機能
-- 1メッセージに 1 つのイベントを紐づける。
-- チャンネルメンバーのみ閲覧・作成可能。作成者のみ削除可能。

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  attendee_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_channel_start ON public.events(channel_id, start_at);

-- RLS
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- SELECT: チャンネルメンバーなら閲覧可
DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = events.channel_id AND user_id = auth.uid()
    )
  );

-- INSERT: チャンネルメンバーなら作成可
DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = events.channel_id AND user_id = auth.uid()
    )
  );

-- DELETE: 作成者のみ削除可
DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete" ON public.events
  FOR DELETE USING (
    created_by = auth.uid()
  );

-- ==========================================
-- イベント作成 RPC
-- messages との紐づけを 1 トランザクションで行う
-- ==========================================
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

  -- チャンネルメンバー確認
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  -- タイトルバリデーション
  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title is empty';
  END IF;

  -- イベント挿入
  INSERT INTO public.events (message_id, channel_id, created_by, title, start_at, location, attendee_ids)
  VALUES (p_message_id, p_channel_id, v_user_id, btrim(p_title), p_start_at, p_location, p_attendee_ids)
  RETURNING * INTO v_event;

  RETURN row_to_json(v_event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID[]) TO authenticated;

-- ==========================================
-- ワークスペース内イベント取得 RPC
-- 指定月のイベントを、ユーザーが所属するチャンネルに限定して返す
-- ==========================================
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
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 対象月の範囲を算出
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
      json_build_object(
        'id', ch.id,
        'name', ch.name,
        'slug', ch.slug
      ) AS channel,
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
    JOIN public.channels ch ON ch.id = e.channel_id
    JOIN public.workspaces w ON w.id = ch.workspace_id
    JOIN public.profiles p ON p.id = e.created_by
    WHERE w.slug = p_workspace_slug
      AND e.start_at >= v_start
      AND e.start_at < v_end
      AND EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.channel_id = e.channel_id AND cm.user_id = p_user_id
      )
  ) ev;

  -- 結果がNULLの場合は空配列を返す
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_events(TEXT, UUID, INT, INT) TO authenticated;

-- ==========================================
-- Realtime 配信を有効化
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
