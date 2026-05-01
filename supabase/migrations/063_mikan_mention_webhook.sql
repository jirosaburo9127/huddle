-- mentions テーブルへの INSERT 時、@みかん 宛てだったら mikan-respond Edge Function を呼ぶ
-- pg_net による非同期 HTTP POST。Edge Function 側でもチャンネル有効化チェックを行う

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

  PERFORM net.http_post(
    url := v_url,
    body := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_mikan_mention ON public.mentions;
CREATE TRIGGER trigger_mikan_mention
  AFTER INSERT ON public.mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_mikan_mention();
