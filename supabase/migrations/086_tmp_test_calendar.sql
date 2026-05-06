CREATE OR REPLACE FUNCTION public._test_calendar_filter(
  p_user_id UUID,
  p_workspace_slug TEXT,
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
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = p_workspace_slug;
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end := v_start + INTERVAL '1 month';

  SELECT json_agg(json_build_object(
    'id', e.id, 'title', e.title,
    'is_creator', e.created_by = p_user_id,
    'is_attendee', p_user_id = ANY(e.attendee_ids)
  ))
  INTO v_result
  FROM public.events e
  LEFT JOIN public.channels ch ON ch.id = e.channel_id
  WHERE e.start_at >= v_start AND e.start_at < v_end
    AND (e.created_by = p_user_id OR p_user_id = ANY(e.attendee_ids))
    AND (e.channel_id IS NULL OR ch.workspace_id = v_workspace_id);

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
