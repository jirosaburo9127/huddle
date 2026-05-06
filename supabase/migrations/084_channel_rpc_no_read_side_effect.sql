-- 未読バッジが「画面内に表示されただけで消える」バグの修正。
--
-- 原因: Next.js のサイドバー <Link prefetch> が、チャンネル名が viewport に
-- 入った瞬間に SSR を発火させ、page.tsx の中で get_channel_with_messages を
-- 呼ぶ。RPC が UPDATE channel_members SET last_read_at = NOW() を実行する
-- ため、ユーザーが実際にチャンネルを開いていないのに既読扱いになっていた。
--
-- 対応: RPC からは last_read_at の更新副作用を削除する。実際にナビゲートした
-- タイミングでの既読化は、クライアント側の Sidebar useEffect 内の
-- mark_channel_read RPC で行う (currentChannelId 変化時に発火。既存実装)。
--
-- 後始末: 一時デバッグ用 _inspect_func_def を削除する。

CREATE OR REPLACE FUNCTION public.get_channel_with_messages(
  p_workspace_slug text,
  p_channel_slug text,
  p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_workspace_id UUID;
  v_channel JSON;
  v_messages JSON;
  v_is_member BOOLEAN;
BEGIN
  SELECT id INTO v_workspace_id FROM workspaces WHERE slug = p_workspace_slug;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  SELECT row_to_json(c.*) INTO v_channel FROM channels c
    WHERE c.workspace_id = v_workspace_id AND c.slug = p_channel_slug;
  IF v_channel IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS(
    SELECT 1 FROM channel_members
    WHERE channel_id = (v_channel->>'id')::UUID AND user_id = p_user_id
  ) INTO v_is_member;

  -- 公開チャンネルでまだメンバーでなければ自動 join (これは prefetch でも
  -- 起きていいので残す。RLS で誰でも join できる public channel に対する
  -- 暗黙的なメンバー登録)
  IF NOT v_is_member AND NOT (v_channel->>'is_private')::BOOLEAN THEN
    INSERT INTO channel_members (channel_id, user_id)
      VALUES ((v_channel->>'id')::UUID, p_user_id)
      ON CONFLICT DO NOTHING;
  END IF;

  -- ★ 旧版: ここで UPDATE channel_members SET last_read_at = NOW() ...
  --   を実行していたため Link prefetch だけで既読化されていた。撤去。

  SELECT json_agg(t) INTO v_messages FROM (
    SELECT m.*, row_to_json(p.*) as profiles,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', r.id, 'message_id', r.message_id, 'user_id', r.user_id,
          'emoji', r.emoji, 'created_at', r.created_at,
          'display_name', rp.display_name
        ))
        FROM reactions r
        JOIN profiles rp ON rp.id = r.user_id
        WHERE r.message_id = m.id
      ), '[]'::json) as reactions
    FROM messages m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.channel_id = (v_channel->>'id')::UUID
      AND m.parent_id IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.created_at ASC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'channel', v_channel,
    'messages', COALESCE(v_messages, '[]'::json)
  );
END;
$function$;

-- 一時 debug 関数の片付け
DROP FUNCTION IF EXISTS public._inspect_func_def(TEXT);
