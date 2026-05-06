-- カレンダーには「自分が参加している予定だけ」を表示する。
--
-- 旧: チャンネル予定は「そのチャンネルのメンバーなら」表示されていた
--    → 同じチャンネルにいるだけで他人の予定がカレンダーに溢れる
-- 新: 「作成者本人 OR attendee_ids に含まれる」場合のみ表示
--    (個人予定もチャンネル予定も同じルール)
-- workspace 外のチャンネル予定は引き続き除外。

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
      -- ★ 参加者のみ: 作成者 or attendee に含まれる
      AND (
        e.created_by = p_user_id
        OR p_user_id = ANY(e.attendee_ids)
      )
      -- workspace 範囲: 個人予定は workspace 関係なく見せる、
      -- チャンネル予定は対象 workspace のものに限定
      AND (
        e.channel_id IS NULL
        OR ch.workspace_id = v_workspace_id
      )
  ) ev;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
