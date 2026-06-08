-- みかん: 盛り上がっている会話への自動参加トリガー
--
-- messages INSERT 時に直近30分の活動量をチェックし、
-- 閾値を超えたら mikan-respond Edge Function を呼ぶ。
-- mikan-respond 側で table='active_discussion' を識別して処理する。
--
-- 閾値:
--   - 直近30分に5件以上のメッセージ（みかん以外、親メッセージのみ）
--   - 2人以上の異なるユーザーが投稿している
-- クールダウン:
--   - 同一チャンネルでみかんが60分以内に投稿済みならスキップ

CREATE OR REPLACE FUNCTION public.notify_mikan_active_discussion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_url TEXT;
  v_secret TEXT;
  v_channel_enabled BOOLEAN;
  v_is_dm BOOLEAN;
  v_is_hitorigoto BOOLEAN;
  v_msg_count INTEGER;
  v_user_count INTEGER;
  v_mikan_recent BOOLEAN;
  v_threshold_time TIMESTAMPTZ := NOW() - INTERVAL '30 minutes';
  v_cooldown_time TIMESTAMPTZ := NOW() - INTERVAL '60 minutes';
BEGIN
  -- みかん自身の投稿は無視
  IF NEW.user_id = v_mikan_id THEN
    RETURN NEW;
  END IF;

  -- 返信（スレッド）は無視
  IF NEW.parent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- チャンネル情報を確認
  SELECT mikan_enabled, is_dm, is_hitorigoto
    INTO v_channel_enabled, v_is_dm, v_is_hitorigoto
    FROM public.channels WHERE id = NEW.channel_id;

  IF NOT v_channel_enabled OR v_is_dm OR v_is_hitorigoto THEN
    RETURN NEW;
  END IF;

  -- クールダウン: みかんが60分以内に投稿済みならスキップ
  SELECT EXISTS(
    SELECT 1 FROM public.messages
    WHERE channel_id = NEW.channel_id
      AND user_id = v_mikan_id
      AND parent_id IS NULL
      AND deleted_at IS NULL
      AND created_at > v_cooldown_time
  ) INTO v_mikan_recent;

  IF v_mikan_recent THEN
    RETURN NEW;
  END IF;

  -- 直近30分のメッセージ数とユーザー数をカウント（みかん以外）
  SELECT COUNT(*), COUNT(DISTINCT user_id)
    INTO v_msg_count, v_user_count
    FROM public.messages
    WHERE channel_id = NEW.channel_id
      AND user_id <> v_mikan_id
      AND parent_id IS NULL
      AND deleted_at IS NULL
      AND created_at > v_threshold_time;

  -- 閾値: 5件以上 かつ 2人以上
  IF v_msg_count < 5 OR v_user_count < 2 THEN
    RETURN NEW;
  END IF;

  -- Edge Function を呼ぶ
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://emfngqketrieioxusuhg.supabase.co';
  END IF;
  v_url := v_url || '/functions/v1/mikan-respond';

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'mikan_webhook_secret'
    LIMIT 1;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'active_discussion',
      'schema', 'public',
      'record', jsonb_build_object(
        'channel_id', NEW.channel_id,
        'message_id', NEW.id,
        'msg_count', v_msg_count,
        'user_count', v_user_count
      )
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(current_setting('supabase.service_role_key', true), ''),
      'X-Mikan-Secret', COALESCE(v_secret, '')
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_mikan_active_discussion ON public.messages;
CREATE TRIGGER trigger_mikan_active_discussion
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_mikan_active_discussion();
