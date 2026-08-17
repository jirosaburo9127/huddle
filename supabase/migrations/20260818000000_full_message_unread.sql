-- 未読バッジを「全メッセージ」ベースに戻す。
-- 要望: どのチャンネルに投稿があったかを数字バッジで分かるようにしたい。
-- 2026-08-06 の relevance ベース（自分宛=返信/@me/@all のみカウント）を撤回する。
--
-- バッジの意味を保つため、以下は集計から除外する:
--   * 自分の投稿           (m.user_id <> p_user_id)
--   * 削除済みメッセージ    (m.deleted_at IS NULL)
--   * システムメッセージ    (m.system_event IS NULL のみ集計。
--                            投票/決定登録/メンバー参加/アルバム更新は「投稿」ではないので数えない)
--   * リアクション          messages テーブルではないため元々含まれない（幽霊バッジ回避）
--
-- get_unread_counts_by_workspace と get_workspace_data は get_unread_counts を呼ぶだけなので変更不要。
CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
 RETURNS TABLE(channel_id uuid, unread_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: p_user_id must match auth.uid()';
  END IF;
  RETURN QUERY
  WITH mem AS (
    SELECT cm.channel_id AS ch, COALESCE(cm.last_read_at, cm.joined_at) AS since
    FROM channel_members cm
    WHERE cm.user_id = p_user_id
  )
  SELECT mem.ch, COUNT(*)::bigint
  FROM mem
  JOIN messages m ON m.channel_id = mem.ch
    AND m.created_at > mem.since
    AND m.deleted_at IS NULL
    AND m.user_id <> p_user_id
    AND m.system_event IS NULL
  GROUP BY mem.ch
  HAVING COUNT(*) > 0;
END;
$function$;
