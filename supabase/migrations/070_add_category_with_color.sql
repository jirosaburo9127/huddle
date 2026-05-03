-- カテゴリ追加時に色も同時に指定できるよう RPC を拡張
-- 既存の add_workspace_category(uuid, text) を残したまま、新しい引数の関数を追加する
-- (PostgreSQL は引数シグネチャでオーバーロードを区別するので、両方とも保持できる)

CREATE OR REPLACE FUNCTION public.add_workspace_category(
  p_workspace_id UUID,
  p_label TEXT,
  p_color TEXT
) RETURNS public.workspace_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_slug TEXT;
  v_max_order INT;
  v_result public.workspace_categories;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ワークスペースメンバーか確認
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

  -- slug 自動生成 (既存実装と同じくタイムスタンプベース)
  v_slug := 'cat-' || extract(epoch from now())::bigint::text;

  -- 現在の最大 sort_order
  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_order
    FROM public.workspace_categories
    WHERE workspace_id = p_workspace_id;

  INSERT INTO public.workspace_categories (workspace_id, slug, label, sort_order, color)
    VALUES (p_workspace_id, v_slug, btrim(p_label), v_max_order + 1, p_color)
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_workspace_category(UUID, TEXT, TEXT) TO authenticated;
