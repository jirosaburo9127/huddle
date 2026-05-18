-- アルバム機能
-- イベントごとに写真・動画をまとめるアルバム。
-- チャンネル内で作成し、集約ページで全チャンネル横断表示。

CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cover_url TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_albums_channel ON public.albums(channel_id);

CREATE TABLE IF NOT EXISTS public.album_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'image',
  file_name TEXT,
  added_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_album_items_album ON public.album_items(album_id);

-- RLS
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_items ENABLE ROW LEVEL SECURITY;

-- albums: チャンネルメンバーなら閲覧可
CREATE POLICY "albums_select" ON public.albums
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = albums.channel_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "albums_insert" ON public.albums
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = albums.channel_id AND user_id = auth.uid()
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "albums_update" ON public.albums
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "albums_delete" ON public.albums
  FOR DELETE USING (created_by = auth.uid());

-- album_items: アルバムが属するチャンネルのメンバーなら閲覧・追加可
CREATE POLICY "album_items_select" ON public.album_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.albums a
      JOIN public.channel_members cm ON cm.channel_id = a.channel_id
      WHERE a.id = album_items.album_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "album_items_insert" ON public.album_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.albums a
      JOIN public.channel_members cm ON cm.channel_id = a.channel_id
      WHERE a.id = album_items.album_id AND cm.user_id = auth.uid()
    )
    AND added_by = auth.uid()
  );

CREATE POLICY "album_items_delete" ON public.album_items
  FOR DELETE USING (added_by = auth.uid());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.album_items;

-- 集約ページ用RPC: 自分が参加しているチャンネルのアルバム一覧
CREATE OR REPLACE FUNCTION public.get_my_albums(p_workspace_id uuid, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result json;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COALESCE(json_agg(t ORDER BY t.created_at DESC), '[]'::json) INTO v_result FROM (
    SELECT
      a.id, a.title, a.cover_url, a.created_by, a.created_at,
      a.channel_id,
      c.name AS channel_name, c.slug AS channel_slug,
      p.display_name AS creator_name,
      (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id = a.id) AS item_count,
      (SELECT ai2.url FROM album_items ai2 WHERE ai2.album_id = a.id ORDER BY ai2.created_at ASC LIMIT 1) AS first_item_url
    FROM albums a
    JOIN channels c ON c.id = a.channel_id
    JOIN profiles p ON p.id = a.created_by
    JOIN channel_members cm ON cm.channel_id = a.channel_id AND cm.user_id = p_user_id
    WHERE c.workspace_id = p_workspace_id
  ) t;

  RETURN v_result;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.albums TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.album_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_albums(uuid, uuid) TO authenticated;
