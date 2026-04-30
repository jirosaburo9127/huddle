-- アクティビティ拡張: メンション + 返信 (B-1: 自分の投稿への返信)
-- 既存の「自分の投稿へのリアクション」に加えて以下2種を追加し、
-- サイドバーのアクティビティドットは「いずれか未読あれば点灯」させる。

-- ============================================================================
-- 1) 既読タイムスタンプ列を追加（リアクション既読とは独立に管理）
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mention_seen_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reply_seen_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================================
-- 2) メンション一覧取得 RPC
--    自分宛て (mentioned_user_id = p_user_id) のメッセージを WS スコープで返す。
--    自分自身が書いた投稿は除外（自分メンション運用回避）。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_mentions(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  mention_id UUID,
  mentioned_at TIMESTAMPTZ,
  author_id UUID,
  author_name TEXT,
  author_avatar TEXT,
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
    mn.id AS mention_id,
    m.created_at AS mentioned_at,
    m.user_id AS author_id,
    p.display_name AS author_name,
    p.avatar_url AS author_avatar,
    m.id AS message_id,
    m.content AS message_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug
  FROM public.mentions mn
  JOIN public.messages m ON m.id = mn.message_id
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE mn.mentioned_user_id = p_user_id
    AND m.user_id <> p_user_id
    AND m.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_mentions(UUID, UUID, INT) TO authenticated;

-- ============================================================================
-- 3) 返信一覧取得 RPC (B-1: 自分の投稿への返信)
--    parent_id が「自分が書いた投稿」を指す messages を WS スコープで返す。
--    自分の自己返信は除外。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_replies(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  reply_id UUID,
  replied_at TIMESTAMPTZ,
  replier_id UUID,
  replier_name TEXT,
  replier_avatar TEXT,
  reply_content TEXT,
  parent_message_id UUID,
  parent_content TEXT,
  channel_id UUID,
  channel_name TEXT,
  channel_slug TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id AS reply_id,
    r.created_at AS replied_at,
    r.user_id AS replier_id,
    rp.display_name AS replier_name,
    rp.avatar_url AS replier_avatar,
    r.content AS reply_content,
    parent.id AS parent_message_id,
    parent.content AS parent_content,
    c.id AS channel_id,
    c.name AS channel_name,
    c.slug AS channel_slug
  FROM public.messages r
  JOIN public.messages parent ON parent.id = r.parent_id
  JOIN public.channels c ON c.id = r.channel_id
  JOIN public.profiles rp ON rp.id = r.user_id
  WHERE parent.user_id = p_user_id
    AND r.user_id <> p_user_id
    AND r.deleted_at IS NULL
    AND parent.deleted_at IS NULL
    AND c.workspace_id = p_workspace_id
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_replies(UUID, UUID, INT) TO authenticated;

-- ============================================================================
-- 4) 既読マーク RPC (mention / reply 個別)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_mention_seen()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET mention_seen_at = NOW() WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_mention_seen() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_reply_seen()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET reply_seen_at = NOW() WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_reply_seen() TO authenticated;

-- ============================================================================
-- 5) has_unread_activity を「リアクション or メンション or 返信」のOR判定へ拡張
--    サイドバーは引き続き 1RPC コールでドット点灯判定できるようにする
--    （既存呼び出し元の互換維持）。
-- ============================================================================
DROP FUNCTION IF EXISTS public.has_unread_activity(UUID, UUID);

CREATE OR REPLACE FUNCTION public.has_unread_activity(
  p_user_id UUID,
  p_workspace_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    -- (A) リアクション: 自分の投稿に他者がリアクション
    EXISTS (
      SELECT 1
      FROM public.reactions r
      JOIN public.messages m ON m.id = r.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE m.user_id = p_user_id
        AND r.user_id <> p_user_id
        AND m.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
    )
    OR
    -- (B) メンション: 自分宛て @
    EXISTS (
      SELECT 1
      FROM public.mentions mn
      JOIN public.messages m ON m.id = mn.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE mn.mentioned_user_id = p_user_id
        AND m.user_id <> p_user_id
        AND m.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND m.created_at > COALESCE(p.mention_seen_at, '1970-01-01'::timestamptz)
    )
    OR
    -- (C) 返信: 自分の投稿に他者が返信
    EXISTS (
      SELECT 1
      FROM public.messages r
      JOIN public.messages parent ON parent.id = r.parent_id
      JOIN public.channels c ON c.id = r.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE parent.user_id = p_user_id
        AND r.user_id <> p_user_id
        AND r.deleted_at IS NULL
        AND parent.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.reply_seen_at, '1970-01-01'::timestamptz)
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_unread_activity(UUID, UUID) TO authenticated;
