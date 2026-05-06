CREATE OR REPLACE FUNCTION public._tmp_test_initial_msgs(p_channel_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_first_dt TIMESTAMPTZ;
  v_last_dt TIMESTAMPTZ;
  v_count INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM messages WHERE channel_id = p_channel_id AND parent_id IS NULL AND deleted_at IS NULL;
  WITH page AS (
    SELECT created_at FROM messages
    WHERE channel_id = p_channel_id AND parent_id IS NULL AND deleted_at IS NULL
    ORDER BY created_at ASC LIMIT 50
  )
  SELECT MIN(created_at), MAX(created_at), COUNT(*) INTO v_first_dt, v_last_dt, v_count FROM page;
  RETURN json_build_object('total', v_total, 'returned', v_count,
    'oldest_in_page', v_first_dt::TEXT, 'newest_in_page', v_last_dt::TEXT);
END;
$$;
