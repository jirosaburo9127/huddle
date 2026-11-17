-- 検索結果のページング対応
-- 旧実装は新しい順に30件で打ち切っていたため、ヒット数が多い語では
-- 古いメッセージが検索結果に一切出なかった。p_offset を追加して続きを取得できるようにする。
-- 引数が変わると別関数(オーバーロード)になり呼び出しが曖昧になるため、旧シグネチャは削除する。
BEGIN;

DROP FUNCTION IF EXISTS public.search_messages(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.search_messages(
  p_user_id uuid,
  p_workspace_id uuid,
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;

  SELECT COALESCE(json_agg(row ORDER BY row.created_at DESC, row.id DESC), '[]'::json)
  INTO v_result
  FROM (
    SELECT
      m.id, m.content, m.created_at, m.channel_id,
      ch.name AS channel_name, ch.slug AS channel_slug,
      p.display_name AS sender_name, p.avatar_url AS sender_avatar
    FROM public.messages m
    JOIN public.channels ch ON ch.id = m.channel_id
    JOIN public.profiles p ON p.id = m.user_id
    WHERE ch.workspace_id = p_workspace_id
      AND m.deleted_at IS NULL
      AND (
        m.content ILIKE '%' || p_query || '%'
        OR ch.name ILIKE '%' || p_query || '%'
      )
      AND EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.channel_id = m.channel_id AND cm.user_id = p_user_id
      )
    -- id を第2キーにして、同時刻の投稿があってもページ間で重複・欠落しないようにする
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.search_messages(uuid, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_messages(uuid, uuid, text, integer, integer) TO authenticated;

COMMIT;
