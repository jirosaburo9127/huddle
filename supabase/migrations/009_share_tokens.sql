-- ═══════════════════════════════════════════════
-- 進捗ダッシュボードの共有トークン
-- 伴奏マイスター（講師陣）へログイン不要で読み専用共有するため
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_workspace
  ON public.share_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_token_active
  ON public.share_tokens(token) WHERE is_active;

ALTER TABLE public.share_tokens ENABLE ROW LEVEL SECURITY;

-- オーナー/管理者のみがトークンを管理できる
DROP POLICY IF EXISTS "share_tokens_admin_all" ON public.share_tokens;
CREATE POLICY "share_tokens_admin_all" ON public.share_tokens
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = share_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = share_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- ═══════════════════════════════════════════════
-- SECURITY DEFINER 関数: 共有ページから RLS バイパスで
-- ダッシュボードデータを取得する
-- ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_shared_dashboard_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_result jsonb;
BEGIN
  -- トークン検証
  SELECT workspace_id INTO v_workspace_id
  FROM public.share_tokens
  WHERE token = p_token
    AND is_active
    AND expires_at > now();

  IF v_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (
      SELECT jsonb_build_object('id', id, 'name', name, 'slug', slug)
      FROM public.workspaces WHERE id = v_workspace_id
    ),
    'decisions', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
      FROM (
        SELECT m.id, m.content, m.created_at,
               c.name AS channel_name,
               p.display_name AS sender_name,
               p.avatar_url AS sender_avatar
        FROM public.messages m
        JOIN public.channels c ON c.id = m.channel_id
        JOIN public.profiles p ON p.id = m.user_id
        WHERE c.workspace_id = v_workspace_id
          AND m.is_decision = true
          AND m.deleted_at IS NULL
          AND c.is_dm = false
        ORDER BY m.created_at DESC
        LIMIT 100
      ) d
    ),
    'stats', (
      SELECT jsonb_build_object(
        'decisions_this_week', (
          SELECT count(*)
          FROM public.messages m
          JOIN public.channels c ON c.id = m.channel_id
          WHERE c.workspace_id = v_workspace_id
            AND m.is_decision = true
            AND m.deleted_at IS NULL
            AND c.is_dm = false
            AND m.created_at > now() - interval '7 days'
        ),
        'decisions_total', (
          SELECT count(*)
          FROM public.messages m
          JOIN public.channels c ON c.id = m.channel_id
          WHERE c.workspace_id = v_workspace_id
            AND m.is_decision = true
            AND m.deleted_at IS NULL
            AND c.is_dm = false
        ),
        'active_channels', (
          SELECT count(DISTINCT c.id)
          FROM public.channels c
          WHERE c.workspace_id = v_workspace_id
            AND c.is_dm = false
        )
      )
    )
  ) INTO v_result;

  -- 最終アクセス時刻を更新（ログ代わり）
  UPDATE public.share_tokens
  SET last_accessed_at = now()
  WHERE token = p_token;

  RETURN v_result;
END;
$$;

-- 匿名ユーザーからも呼び出せるように grant
GRANT EXECUTE ON FUNCTION public.get_shared_dashboard_data(text) TO anon, authenticated;
