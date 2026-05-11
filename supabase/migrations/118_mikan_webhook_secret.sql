-- notify_mikan_mention() に X-Mikan-Secret ヘッダを追加。
--
-- 経緯: Supabase Cloud では Edge Function gateway が
--   `Authorization: Bearer ' || current_setting('supabase.service_role_key', true)`
-- の GUC を空文字で返すため、Authorization 厳密一致を Edge Function 側で
-- やると正規呼び出しまで 401 で弾けてしまう (huddle-supabase-gotchas 項目 9 参照)。
--
-- 代わりに、専用 secret `mikan_webhook_secret` を Supabase Vault に保管し、
-- DB トリガー側で Vault から取り出して X-Mikan-Secret ヘッダで送る。
-- Edge Function 側は環境変数 MIKAN_WEBHOOK_SECRET と突合する。
--
-- Vault への secret 投入は本 migration 適用前に CLI で完了している:
--   SELECT vault.create_secret('<hex>', 'mikan_webhook_secret', '...');

CREATE OR REPLACE FUNCTION public.notify_mikan_mention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_url TEXT;
  v_payload JSONB;
  v_secret TEXT;
BEGIN
  -- みかん宛てメンション以外は呼ばない（コスト節約）
  IF NEW.mentioned_user_id <> v_mikan_id THEN
    RETURN NEW;
  END IF;

  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://emfngqketrieioxusuhg.supabase.co';
  END IF;
  v_url := v_url || '/functions/v1/mikan-respond';

  -- Vault から webhook secret を取得 (Edge Function 側との共有 secret)
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'mikan_webhook_secret'
    LIMIT 1;

  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'mentions',
    'schema', 'public',
    'record', jsonb_build_object(
      'id', NEW.id,
      'message_id', NEW.message_id,
      'mentioned_user_id', NEW.mentioned_user_id,
      'mention_type', NEW.mention_type
    ),
    'old_record', NULL
  );

  PERFORM net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Authorization は Edge Function の verify_jwt を満たすために残す
      -- (中身が空でも anon key より厳しい突合は X-Mikan-Secret 側で行う)
      'Authorization', 'Bearer ' || COALESCE(current_setting('supabase.service_role_key', true), ''),
      'X-Mikan-Secret', COALESCE(v_secret, '')
    )
  );

  RETURN NEW;
END;
$$;
