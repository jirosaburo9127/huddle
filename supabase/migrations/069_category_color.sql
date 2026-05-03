-- カテゴリに色を持たせ、配下のチャンネル名をその色で表示できるようにする
-- color は HEX (#RRGGBB) を期待。NULL = 色なし (デフォルト)

ALTER TABLE public.workspace_categories
  ADD COLUMN IF NOT EXISTS color TEXT;

-- 色更新 RPC (ワークスペースメンバーのみ)
CREATE OR REPLACE FUNCTION public.update_workspace_category_color(
  p_workspace_id UUID,
  p_slug TEXT,
  p_color TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- color は HEX (#RRGGBB / #RRGGBBAA) または NULL のみ受け付ける
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$' THEN
    RAISE EXCEPTION 'invalid color format';
  END IF;

  UPDATE public.workspace_categories
  SET color = p_color
  WHERE workspace_id = p_workspace_id AND slug = p_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_workspace_category_color(UUID, TEXT, TEXT) TO authenticated;
