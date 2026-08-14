-- 会話整理: チャンネルメンバーなら誰でもメッセージを soft-delete できるようにする専用RPC。
-- RLSの UPDATE を緩めると「他人の投稿の本文編集」まで許してしまうため、削除だけを別RPCで担保する
-- （編集は従来どおり作者のみ）。単数・複数(一括)どちらも p_message_ids 配列で扱う。

CREATE OR REPLACE FUNCTION public.soft_delete_messages(p_message_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  -- 呼び出し者がメンバーであるチャンネルの、未削除メッセージだけを soft-delete する
  UPDATE messages m
     SET deleted_at = now()
   WHERE m.id = ANY(p_message_ids)
     AND m.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM channel_members cm
       WHERE cm.channel_id = m.channel_id AND cm.user_id = auth.uid()
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.soft_delete_messages(uuid[]) TO authenticated;
