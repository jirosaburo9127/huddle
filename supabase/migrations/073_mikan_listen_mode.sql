-- (a) 確定リアクションのルールを「チャンネルメンバー誰でも」に緩める。
--     for_user_id 限定だと、みかんが文脈から自動提案するモードで誰が頼んだか
--     特定できないため。events.created_by はリアクションした人 (= 確定者)。
-- (b) messages INSERT で mikan-enabled チャンネルでは
--     mikan-respond Edge Function を listen モードで呼ぶトリガーを追加。
--     @みかん が本文に含まれているメッセージは notify_mikan_mention 側で
--     処理されるため、ここでは重複起動を避けてスキップする。

-- ============================================================================
-- (a) リアクション → 提案確定 トリガーの更新
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_event_proposal_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal RECORD;
  v_event_msg_id UUID;
  v_event_id UUID;
  v_loc_line TEXT;
  v_event_msg_content TEXT;
  v_is_member BOOLEAN;
BEGIN
  -- 対象メッセージが pending 提案か?
  SELECT * INTO v_proposal FROM public.event_proposals
    WHERE message_id = NEW.message_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- リアクションした人がチャンネルメンバーであることを確認
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = v_proposal.channel_id AND user_id = NEW.user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN NEW;
  END IF;

  -- 期限切れチェック
  IF v_proposal.expires_at < NOW() THEN
    UPDATE public.event_proposals SET status = 'expired' WHERE id = v_proposal.id;
    RETURN NEW;
  END IF;

  -- イベントカード本文を組み立て
  IF v_proposal.location IS NOT NULL AND length(btrim(v_proposal.location)) > 0 THEN
    v_loc_line := E'\n📍 ' || v_proposal.location;
  ELSE
    v_loc_line := '';
  END IF;
  v_event_msg_content := format(
    E'📅 %s\n%s%s',
    v_proposal.title,
    public._format_dt_ja(v_proposal.starts_at),
    v_loc_line
  );

  -- みかんから「📅 ...」メッセージを投稿
  INSERT INTO public.messages (channel_id, user_id, content)
    VALUES (v_proposal.channel_id, v_proposal.proposed_by, v_event_msg_content)
    RETURNING id INTO v_event_msg_id;

  -- events 行を作成 (created_by はリアクションした人 = 確定者)
  INSERT INTO public.events (
    message_id, channel_id, created_by, title, start_at, location, attendee_ids
  ) VALUES (
    v_event_msg_id,
    v_proposal.channel_id,
    NEW.user_id,
    v_proposal.title,
    v_proposal.starts_at,
    v_proposal.location,
    '{}'
  )
  RETURNING id INTO v_event_id;

  UPDATE public.event_proposals
    SET status = 'confirmed', confirmed_event_id = v_event_id
    WHERE id = v_proposal.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_event_proposal_reaction failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- (b) messages INSERT → mikan listen モード呼び出し
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_mikan_listen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mikan_id UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_url TEXT;
  v_payload JSONB;
  v_enabled BOOLEAN;
BEGIN
  -- みかん自身の投稿は無視 (無限ループ防止)
  IF NEW.user_id = v_mikan_id THEN RETURN NEW; END IF;

  -- @みかん が含まれているメッセージは notify_mikan_mention 側で処理されるためスキップ
  IF NEW.content LIKE '%@みかん%' THEN RETURN NEW; END IF;

  -- 削除済み / parent_id 付き (返信スレッド) も対象
  -- (返信内で日時が決まることもあるため対象に含める)

  -- mikan_enabled チャンネル以外は無視
  SELECT mikan_enabled INTO v_enabled FROM public.channels WHERE id = NEW.channel_id;
  IF NOT COALESCE(v_enabled, false) THEN RETURN NEW; END IF;

  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://emfngqketrieioxusuhg.supabase.co';
  END IF;
  v_url := v_url || '/functions/v1/mikan-respond';

  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'messages',
    'schema', 'public',
    'record', jsonb_build_object(
      'id', NEW.id,
      'channel_id', NEW.channel_id,
      'user_id', NEW.user_id,
      'content', NEW.content,
      'created_at', NEW.created_at
    ),
    'old_record', NULL
  );

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

DROP TRIGGER IF EXISTS messages_mikan_listen_trigger ON public.messages;
CREATE TRIGGER messages_mikan_listen_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_mikan_listen();
