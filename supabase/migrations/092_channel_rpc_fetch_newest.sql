-- 「もっと前のメッセージを読み込む」ボタンが反応しない不具合の修正。
--
-- 原因: get_channel_with_messages の本体が
--   ORDER BY m.created_at ASC LIMIT 50
-- になっていて、チャンネル内の「最古から 50 件」を返していた。
-- ・総メッセージ数が 50 を超えていると、初期表示は最古 50 件で固定され、
--   最新側のメッセージは画面に出ないし、messages[0] = チャンネル最古の行になる。
-- ・「もっと前」ボタンは messages[0].created_at より厳密に古い行を取りに行くので、
--   それより古い行は存在せず常に 0 件 → 何も読み込まれない、という挙動。
--
-- 対応: 内部 SELECT を ORDER BY m.created_at DESC LIMIT 50 にして「最新 50 件」を取り、
-- 外側の json_agg(... ORDER BY created_at ASC) で表示順 (古→新) に並べ直して返す。
-- 084 で外した last_read_at 副作用や public channel 自動 join はそのまま維持。

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

  IF NOT v_is_member AND NOT (v_channel->>'is_private')::BOOLEAN THEN
    INSERT INTO channel_members (channel_id, user_id)
      VALUES ((v_channel->>'id')::UUID, p_user_id)
      ON CONFLICT DO NOTHING;
  END IF;

  SELECT json_agg(t ORDER BY t.created_at ASC) INTO v_messages FROM (
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
    ORDER BY m.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'channel', v_channel,
    'messages', COALESCE(v_messages, '[]'::json)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public._tmp_test_initial_msgs(UUID);
