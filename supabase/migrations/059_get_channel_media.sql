-- チャンネル内のメディア（ファイル添付）一覧を取得する RPC。
-- メッセージ内容に Supabase Storage の chat-files URL が含まれているものだけを返す。
-- 投稿者の表示名・アバター URL も同梱して、フロント側で複数 RPC を呼ばずに済むようにする。
--
-- フロント側で content からファイル URL を抽出し、isImage / isVideo で分類する想定。
-- 1メッセージに複数ファイルがあるケースは content にすべて含まれているのでこの RPC で OK。

CREATE OR REPLACE FUNCTION public.get_channel_media(
  p_channel_id UUID,
  p_limit INT DEFAULT 200
)
RETURNS TABLE(
  message_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    m.id AS message_id,
    m.content,
    m.created_at,
    m.user_id,
    p.display_name,
    p.avatar_url
  FROM public.messages m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.channel_id = p_channel_id
    AND m.deleted_at IS NULL
    -- chat-files Bucket の URL を含むメッセージのみ
    AND m.content LIKE '%/storage/v1/object/public/chat-files/%'
    -- 呼び出し元がこのチャンネルのメンバーであることを確認（RLS とは別に明示）
    AND EXISTS (
      SELECT 1 FROM public.channel_members cm
      WHERE cm.channel_id = p_channel_id
        AND cm.user_id = auth.uid()
    )
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_channel_media(UUID, INT) TO authenticated;
