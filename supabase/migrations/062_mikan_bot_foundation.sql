-- みかん（AIファシリテーターBot）の基盤
-- PoC: チャンネル単位で有効化/無効化できる柔らかい中立者キャラ
-- @みかん メンションに反応する MVP

-- ============================================================================
-- 1) profiles.is_bot: bot ユーザーを識別するフラグ
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 2) channels.mikan_enabled: チャンネル単位でみかんを ON/OFF
-- ============================================================================
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS mikan_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 3) みかん bot ユーザーの作成
--    auth.users に bot 専用 UUID で 1 行作成し、profiles に紐づける
--    パスワードは使わないので暗号化済みの空文字を入れる（ログイン不可）
-- ============================================================================
DO $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
BEGIN
  -- auth.users に bot ユーザーを作成（既存ならスキップ）
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_mikan_id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) VALUES (
      v_mikan_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'mikan-bot@huddle.local',
      '', NOW(), '{"provider":"bot"}'::jsonb, '{}'::jsonb,
      NOW(), NOW(), FALSE, FALSE
    );
  END IF;

  -- profiles に bot プロファイル作成（既存ならスキップ）
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_mikan_id) THEN
    INSERT INTO public.profiles (id, email, display_name, avatar_url, is_bot)
    VALUES (
      v_mikan_id,
      'mikan-bot@huddle.local',
      'みかん',
      NULL, -- アバターは後で差し替え。当面はテキストイニシャル「み」表示
      TRUE
    );
  END IF;
END $$;

-- ============================================================================
-- 4) みかんを全ワークスペースのメンバーに追加 (workspace_members)
--    ワークスペースに参加していないと get_workspace_data から見えないため
-- ============================================================================
DO $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_ws RECORD;
BEGIN
  FOR v_ws IN SELECT id FROM public.workspaces LOOP
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_ws.id, v_mikan_id, 'member')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ============================================================================
-- 5) みかんを mikan_enabled なチャンネルの member に自動追加するトリガ
--    新規チャンネルでも、後で enabled にしても自動でメンバー入りする
-- ============================================================================
CREATE OR REPLACE FUNCTION public._mikan_join_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
BEGIN
  IF NEW.mikan_enabled = TRUE THEN
    INSERT INTO public.channel_members (channel_id, user_id)
    VALUES (NEW.id, v_mikan_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mikan_join_channel ON public.channels;
CREATE TRIGGER trg_mikan_join_channel
  AFTER INSERT OR UPDATE OF mikan_enabled ON public.channels
  FOR EACH ROW
  EXECUTE FUNCTION public._mikan_join_channel();

-- ============================================================================
-- 6) みかん有効化 RPC
--    管理者が PoC 対象チャンネルを ON/OFF するための関数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_mikan_enabled(
  p_channel_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_workspace_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id FROM public.channels WHERE id = p_channel_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;

  -- ワークスペースオーナー / 管理者のみ操作可
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = v_workspace_id
      AND user_id = v_user_id
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE public.channels SET mikan_enabled = p_enabled WHERE id = p_channel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_mikan_enabled(UUID, BOOLEAN) TO authenticated;
