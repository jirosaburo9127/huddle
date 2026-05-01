-- pg_net v0.9+ では net.http_post の body 引数が jsonb になっている
-- 旧 ::text キャスト呼び出しを修正する

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

  -- pg_net 新シグネチャ: body は jsonb で渡す
  PERFORM net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );

  RETURN NEW;
END;
$$;
