-- URL 自動転記 (archive-link) で「URL が読み取れず投稿者に概要を依頼中」の状態を保持。
-- 投稿者が次の発言で概要を書いてきたら、それを概要として「みんなでお勉強」チャンネルに
-- 転記する用途。

CREATE TABLE IF NOT EXISTS public.archive_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  source_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  request_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 投稿者の未解決リクエストを高速に検索するためのインデックス
CREATE INDEX IF NOT EXISTS archive_pending_lookup_idx
  ON public.archive_pending (channel_id, source_user_id)
  WHERE resolved_at IS NULL;

-- お津会の「みんなでお勉強」チャンネルのカテゴリを「その他」に設定
UPDATE public.channels
   SET category = 'その他'
 WHERE id = '1d3cb7bc-ea93-4b55-9f39-edac9c64be62'
   AND (category IS NULL OR category = '');
