-- チャンネルアーカイブ機能
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- アーカイブ/解除 RPC（チャンネルメンバーなら誰でも可）
CREATE OR REPLACE FUNCTION public.set_channel_archived(p_channel_id UUID, p_archived BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM channel_members WHERE channel_id = p_channel_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;
  UPDATE channels SET is_archived = p_archived WHERE id = p_channel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_channel_archived(UUID, BOOLEAN) TO authenticated;
