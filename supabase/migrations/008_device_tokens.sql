-- ═══════════════════════════════════════════════
-- デバイストークン（プッシュ通知送信先）
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- 自分のトークンのみ操作可能
DROP POLICY IF EXISTS "device_tokens_select" ON public.device_tokens;
CREATE POLICY "device_tokens_select" ON public.device_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "device_tokens_insert" ON public.device_tokens;
CREATE POLICY "device_tokens_insert" ON public.device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "device_tokens_update" ON public.device_tokens;
CREATE POLICY "device_tokens_update" ON public.device_tokens
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "device_tokens_delete" ON public.device_tokens;
CREATE POLICY "device_tokens_delete" ON public.device_tokens
  FOR DELETE USING (auth.uid() = user_id);
