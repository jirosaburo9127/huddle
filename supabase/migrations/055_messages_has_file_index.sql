-- ファイル集約ページの取得高速化
-- content LIKE '%...%' は全文スキャンになり遅いので、
-- 生成列 has_file (= URLを含むかの boolean) + 部分インデックス で高速化する

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS has_file boolean
  GENERATED ALWAYS AS (content LIKE '%supabase%storage%chat-files%') STORED;

CREATE INDEX IF NOT EXISTS idx_messages_has_file_created_at
  ON public.messages (created_at DESC)
  WHERE has_file = true AND deleted_at IS NULL;
