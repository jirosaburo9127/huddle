-- アクティビティ機能用: ユーザーが最後にアクティビティ一覧を見た時刻
-- これより新しい「自分の投稿へのリアクション」があれば未読バッジを出す

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activity_seen_at TIMESTAMPTZ DEFAULT NOW();

-- アクティビティ取得 RPC
-- p_user_id が投稿した messages に対する、他ユーザーからの reactions を取得。
-- メッセージ情報、チャンネル情報、リアクター情報を JOIN で付ける。
CREATE OR REPLACE FUNCTION public.get_my_activities(
  p_user_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  reaction_id UUID,
  emoji TEXT,
  reacted_at TIMESTAMPTZ,
  reactor_id UUID,
  reactor_name TEXT,
  reactor_avatar TEXT,
  message_id UUID,
  message_content TEXT,
  channel_id UUID,
  channel_name TEXT,
  channel_slug TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id AS reaction_id,
    r.emoji,
    r.created_at AS reacted_at,
    r.user_id AS reactor_id,
    rp.display_name AS reactor_name,
    rp.avatar_url AS reactor_avatar,
    m.id AS message_id,
    m.content AS message_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug
  FROM public.reactions r
  JOIN public.messages m ON m.id = r.message_id
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.profiles rp ON rp.id = r.user_id
  WHERE m.user_id = p_user_id
    AND r.user_id <> p_user_id
    AND m.deleted_at IS NULL
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_activities(UUID, INT) TO authenticated;

-- アクティビティを既読にする（activity_seen_at を NOW に）
CREATE OR REPLACE FUNCTION public.mark_activity_seen()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET activity_seen_at = NOW() WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_activity_seen() TO authenticated;

-- 未読アクティビティが存在するかの判定 (true/false)
CREATE OR REPLACE FUNCTION public.has_unread_activity(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reactions r
    JOIN public.messages m ON m.id = r.message_id
    JOIN public.profiles p ON p.id = p_user_id
    WHERE m.user_id = p_user_id
      AND r.user_id <> p_user_id
      AND m.deleted_at IS NULL
      AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_unread_activity(UUID) TO authenticated;
