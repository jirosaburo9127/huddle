-- Existing video messages may not have a generated thumbnail URL in their
-- storage URL fragment. Allow channel members to append thumbnail metadata only.

CREATE OR REPLACE FUNCTION public.backfill_message_video_thumbnail(
  p_message_id UUID,
  p_old_url TEXT,
  p_new_url TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_channel_id UUID;
  v_old_base TEXT;
  v_new_base TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_old_url IS NULL OR p_new_url IS NULL THEN
    RETURN FALSE;
  END IF;

  v_old_base := split_part(p_old_url, '#', 1);
  v_new_base := split_part(p_new_url, '#', 1);

  IF v_old_base <> v_new_base THEN
    RETURN FALSE;
  END IF;

  IF p_new_url NOT LIKE v_old_base || '#%' OR p_new_url NOT LIKE '%thumb=%' THEN
    RETURN FALSE;
  END IF;

  IF v_old_base !~ '^https://.*/storage/v1/object/public/chat-files/.*\.(mp4|mov|webm|m4v)(\?.*)?$' THEN
    RETURN FALSE;
  END IF;

  IF p_new_url !~ 'thumb=https%3A%2F%2F.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fchat-files%2F.*' THEN
    RETURN FALSE;
  END IF;

  SELECT channel_id INTO v_channel_id
  FROM public.messages
  WHERE id = p_message_id
    AND deleted_at IS NULL
    AND content LIKE '%' || p_old_url || '%';

  IF v_channel_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.is_channel_member(v_channel_id, v_user_id) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.messages
  SET content = replace(content, p_old_url, p_new_url)
  WHERE id = p_message_id
    AND content LIKE '%' || p_old_url || '%';

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_message_video_thumbnail(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
