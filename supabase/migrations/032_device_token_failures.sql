-- device_tokens に連続失敗カウンターを追加
-- BadDeviceToken 即削除をやめて、3回連続で失敗したトークンだけを削除する。
-- これで sandbox/production 一時的な不一致で誤削除されるループを回避できる。

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_platform
  ON public.device_tokens(user_id, platform);
