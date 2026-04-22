-- Storage使用量を取得するRPC
-- storage.objectsテーブルからchat-filesバケットの合計サイズを返す（バイト単位）
CREATE OR REPLACE FUNCTION public.get_storage_usage()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT COALESCE(SUM((metadata->>'size')::BIGINT), 0)
  FROM storage.objects
  WHERE bucket_id = 'chat-files';
$$;

GRANT EXECUTE ON FUNCTION public.get_storage_usage() TO authenticated;
