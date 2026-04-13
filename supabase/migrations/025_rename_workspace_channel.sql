-- ワークスペース名とチャンネル名の変更機能
-- owner / admin のみ変更可能。slug は name から自動再生成し、衝突時は末尾に数字を追加する。
-- RLS 経由だと slug 衝突時の見え方がややこしいので、SECURITY DEFINER RPC にまとめる。

-- ==========================================
-- ワークスペース名変更
-- ==========================================
CREATE OR REPLACE FUNCTION public.rename_workspace(
  p_workspace_id UUID,
  p_new_name TEXT
)
RETURNS public.workspaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_base_slug TEXT;
  v_slug TEXT;
  v_n INT := 0;
  v_ws public.workspaces;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_new_name IS NULL OR length(btrim(p_new_name)) = 0 THEN
    RAISE EXCEPTION 'empty name';
  END IF;
  IF length(p_new_name) > 80 THEN
    RAISE EXCEPTION 'name too long';
  END IF;

  -- owner / admin のみ変更可能
  SELECT role INTO v_role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = v_user_id;

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- slug 再生成（ASCII化、衝突時は末尾に数字追加）
  v_base_slug := lower(regexp_replace(p_new_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := btrim(v_base_slug, '-');
  IF v_base_slug = '' THEN
    v_base_slug := 'ws-' || substr(p_workspace_id::text, 1, 8);
  END IF;
  v_slug := v_base_slug;

  -- 自分以外のWSが同 slug を使っていたら末尾 -2, -3... を付ける
  WHILE EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE slug = v_slug AND id <> p_workspace_id
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base_slug || '-' || v_n::text;
  END LOOP;

  UPDATE public.workspaces
  SET name = btrim(p_new_name), slug = v_slug
  WHERE id = p_workspace_id
  RETURNING * INTO v_ws;

  RETURN v_ws;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_workspace(UUID, TEXT) TO authenticated;

-- ==========================================
-- チャンネル名変更
-- ==========================================
CREATE OR REPLACE FUNCTION public.rename_channel(
  p_channel_id UUID,
  p_new_name TEXT
)
RETURNS public.channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_workspace_id UUID;
  v_is_dm BOOLEAN;
  v_base_slug TEXT;
  v_slug TEXT;
  v_n INT := 0;
  v_ch public.channels;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_new_name IS NULL OR length(btrim(p_new_name)) = 0 THEN
    RAISE EXCEPTION 'empty name';
  END IF;
  IF length(p_new_name) > 80 THEN
    RAISE EXCEPTION 'name too long';
  END IF;

  SELECT workspace_id, is_dm INTO v_workspace_id, v_is_dm
  FROM public.channels
  WHERE id = p_channel_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;
  IF v_is_dm THEN
    RAISE EXCEPTION 'cannot rename DM';
  END IF;

  -- owner / admin のみ変更可能
  SELECT role INTO v_role
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_id AND user_id = v_user_id;

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- slug 再生成（同一ワークスペース内で一意）
  v_base_slug := lower(regexp_replace(p_new_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := btrim(v_base_slug, '-');
  IF v_base_slug = '' THEN
    v_base_slug := 'ch-' || substr(p_channel_id::text, 1, 8);
  END IF;
  v_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1 FROM public.channels
    WHERE slug = v_slug
      AND workspace_id = v_workspace_id
      AND id <> p_channel_id
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base_slug || '-' || v_n::text;
  END LOOP;

  UPDATE public.channels
  SET name = btrim(p_new_name), slug = v_slug
  WHERE id = p_channel_id
  RETURNING * INTO v_ch;

  RETURN v_ch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_channel(UUID, TEXT) TO authenticated;
