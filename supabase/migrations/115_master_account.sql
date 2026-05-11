-- マスターアカウント (god mode 読み取り専用)
--
-- 目的:
--   オーナー (将来は管理者・教員) が参加していない WS/チャンネルも横断的に
--   閲覧できるようにする。書き込み・削除は不可。中学生向け探究学習プラット
--   フォームでの「教員が生徒の会話を見る」用途にも転用可能な設計。
--
-- 仕組み:
--   1. profiles.is_master フラグ
--   2. SECURITY DEFINER RPC で RLS を物理的にバイパスして読み取り
--   3. 関数冒頭で is_master(auth.uid()) チェック → false なら例外
--   4. 通常 RPC は一切変更しない (参加チャンネルでの体験は完全維持)
--   5. channel_members に行を作らないので、他メンバーから見て master は
--      参加してないチャンネルでは完全に不可視 (last_read_at も更新しない)

-- ============================================================================
-- 1) is_master フラグ
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT FALSE;

-- オーナーを初期マスターに設定 (jiro.saburo9127@gmail.com / 奥のすみか)
UPDATE public.profiles
SET is_master = TRUE
WHERE id = '70b23297-e941-41ef-95b3-3269d6f347b4';

-- ============================================================================
-- 2) is_master() ヘルパー
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_master(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_master FROM public.profiles WHERE id = p_user_id), FALSE);
$$;
GRANT EXECUTE ON FUNCTION public.is_master(uuid) TO authenticated;

-- ============================================================================
-- 3) master_list_workspaces — 全 WS 一覧 + 件数集計
-- ============================================================================
CREATE OR REPLACE FUNCTION public.master_list_workspaces()
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  member_count bigint,
  channel_count bigint,
  message_count bigint,
  latest_message_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized: master only';
  END IF;
  RETURN QUERY
  SELECT
    w.id, w.name, w.slug, w.created_at,
    (SELECT COUNT(*) FROM public.workspace_members wm WHERE wm.workspace_id = w.id),
    (SELECT COUNT(*) FROM public.channels c WHERE c.workspace_id = w.id),
    (SELECT COUNT(*) FROM public.messages m
       JOIN public.channels c ON c.id = m.channel_id
       WHERE c.workspace_id = w.id AND m.deleted_at IS NULL),
    (SELECT MAX(m.created_at) FROM public.messages m
       JOIN public.channels c ON c.id = m.channel_id
       WHERE c.workspace_id = w.id AND m.deleted_at IS NULL)
  FROM public.workspaces w
  ORDER BY w.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.master_list_workspaces() TO authenticated;

-- ============================================================================
-- 4) master_list_channels — そのWSの全チャンネル
-- ============================================================================
CREATE OR REPLACE FUNCTION public.master_list_channels(p_workspace_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  is_dm boolean,
  is_private boolean,
  is_hitorigoto boolean,
  topic text,
  created_at timestamptz,
  member_count bigint,
  message_count bigint,
  latest_message_at timestamptz,
  members json  -- DM の相手特定用に最小限の profile を返す
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized: master only';
  END IF;
  RETURN QUERY
  SELECT
    c.id, c.name, c.slug, c.is_dm, c.is_private,
    COALESCE(c.is_hitorigoto, FALSE),
    c.topic, c.created_at,
    (SELECT COUNT(*) FROM public.channel_members cm WHERE cm.channel_id = c.id),
    (SELECT COUNT(*) FROM public.messages m WHERE m.channel_id = c.id AND m.deleted_at IS NULL),
    (SELECT MAX(m.created_at) FROM public.messages m WHERE m.channel_id = c.id AND m.deleted_at IS NULL),
    COALESCE(
      (SELECT json_agg(json_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url))
       FROM public.channel_members cm
       JOIN public.profiles p ON p.id = cm.user_id
       WHERE cm.channel_id = c.id),
      '[]'::json
    )
  FROM public.channels c
  WHERE c.workspace_id = p_workspace_id
  ORDER BY
    -- 最新メッセージ降順 (アクティブ順)、無いものは作成順
    COALESCE((SELECT MAX(m.created_at) FROM public.messages m WHERE m.channel_id = c.id), c.created_at) DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.master_list_channels(uuid) TO authenticated;

-- ============================================================================
-- 5) master_get_channel_messages — メッセージ + profile + reactions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.master_get_channel_messages(
  p_channel_id uuid,
  p_limit integer DEFAULT 100,
  p_before timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel json;
  v_messages json;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized: master only';
  END IF;

  SELECT row_to_json(c.*) INTO v_channel
  FROM public.channels c
  WHERE c.id = p_channel_id;

  IF v_channel IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(t ORDER BY t.created_at ASC), '[]'::json) INTO v_messages
  FROM (
    SELECT
      m.id, m.channel_id, m.user_id, m.parent_id, m.content,
      m.created_at, m.edited_at, m.deleted_at,
      m.reply_count, m.is_decision, m.status, m.system_event,
      row_to_json(p.*) AS profiles,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', r.id, 'message_id', r.message_id, 'user_id', r.user_id,
          'emoji', r.emoji, 'created_at', r.created_at,
          'display_name', rp.display_name
        ))
         FROM public.reactions r
         JOIN public.profiles rp ON rp.id = r.user_id
         WHERE r.message_id = m.id),
        '[]'::json
      ) AS reactions
    FROM public.messages m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.channel_id = p_channel_id
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('channel', v_channel, 'messages', v_messages);
END;
$$;
GRANT EXECUTE ON FUNCTION public.master_get_channel_messages(uuid, integer, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
