-- 決定事項の通知 + サイドバーバッジ用インフラ
--
-- 追加:
-- - messages.decision_marked_at — 決定にした時刻 (通知/バッジのタイムスタンプに使う)
-- - workspace_members.last_decision_view_at — ダッシュボードを最後に見た時刻
-- - RPC toggle_decision の挙動を拡張: 決定に「する」操作のときに
--   decision_marked_at を NOW() にし、system_event='decision_marked' の
--   システムメッセージを INSERT (既存の send-push パイプラインで通知される)
-- - RPC get_decision_unread_count, mark_decisions_read を新規作成

-- ==========================================
-- カラム追加
-- ==========================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS decision_marked_at TIMESTAMPTZ;

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS last_decision_view_at TIMESTAMPTZ;

-- 既存の決定にも決定時刻を埋めておく (edited_at がなければ created_at)
UPDATE public.messages
SET decision_marked_at = COALESCE(edited_at, created_at)
WHERE is_decision = TRUE AND decision_marked_at IS NULL;

-- ==========================================
-- toggle_decision: 拡張版
-- 決定にするときは decision_marked_at と system_event メッセージを追加
-- 決定解除のときは decision_marked_at = NULL にする (バッジ/通知はしない)
-- ==========================================
CREATE OR REPLACE FUNCTION public.toggle_decision(
  p_message_id UUID,
  p_is_decision BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_channel_id UUID;
  v_msg_content TEXT;
  v_sender_name TEXT;
  v_prev_is_decision BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT channel_id, content, is_decision
    INTO v_channel_id, v_msg_content, v_prev_is_decision
  FROM public.messages
  WHERE id = p_message_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_channel_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not a channel member';
  END IF;

  UPDATE public.messages
  SET is_decision = p_is_decision,
      decision_marked_at = CASE WHEN p_is_decision THEN NOW() ELSE NULL END
  WHERE id = p_message_id;

  -- 決定に「した」ときだけシステムメッセージを入れて通知を飛ばす
  -- 既に決定済みだった場合は二重通知を避けるため何もしない
  IF p_is_decision AND NOT COALESCE(v_prev_is_decision, FALSE) THEN
    SELECT display_name INTO v_sender_name
    FROM public.profiles WHERE id = v_user_id;

    INSERT INTO public.messages (channel_id, user_id, content, system_event)
    VALUES (
      v_channel_id,
      v_user_id,
      '✅ ' || COALESCE(v_sender_name, 'メンバー') || ' が決定事項として登録: ' ||
        CASE
          WHEN length(v_msg_content) > 60 THEN substr(v_msg_content, 1, 60) || '…'
          ELSE v_msg_content
        END,
      'decision_marked'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_decision(UUID, BOOLEAN) TO authenticated;

-- ==========================================
-- get_decision_unread_count: ワークスペース内の未読決定数
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_decision_unread_count(
  p_workspace_id UUID,
  p_user_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(m.id)
  FROM public.messages m
  JOIN public.channels c ON c.id = m.channel_id
  JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = p_user_id
  WHERE c.workspace_id = p_workspace_id
    AND m.is_decision = TRUE
    AND m.deleted_at IS NULL
    AND m.decision_marked_at IS NOT NULL
    AND m.user_id <> p_user_id
    AND m.decision_marked_at > COALESCE(wm.last_decision_view_at, wm.joined_at, '1970-01-01'::timestamptz)
    -- 呼び出しユーザーがそのチャンネルのメンバーであるチャンネルのみ集計
    AND EXISTS (
      SELECT 1 FROM public.channel_members cm
      WHERE cm.channel_id = m.channel_id AND cm.user_id = p_user_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_decision_unread_count(UUID, UUID) TO authenticated;

-- ==========================================
-- mark_decisions_read: ダッシュボード閲覧時に呼ぶ
-- ==========================================
CREATE OR REPLACE FUNCTION public.mark_decisions_read(
  p_workspace_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.workspace_members
  SET last_decision_view_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_decisions_read(UUID) TO authenticated;

-- workspace_members.joined_at が NULL の古いレコード向けのフォールバック用
-- (初期スキーマで joined_at があれば問題ないはず)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_members'
      AND column_name = 'joined_at'
  ) THEN
    ALTER TABLE public.workspace_members ADD COLUMN joined_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;
