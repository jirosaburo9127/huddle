-- リアクション候補のユーザー個別カスタマイズ（追加した自分専用候補 / 非表示にしたプリセット）。
-- 他人には影響しない（自分の profiles 行にのみ保存、profiles_update は auth.uid()=id）。
-- 形: { "custom": ["😍","がんばります"], "hidden": ["orz","m9"] }
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reaction_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
