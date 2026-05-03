-- リアクション挿入時、対象メッセージが「みかんの予定提案」だったら events に変換する。
-- ・提案を頼んだ本人 (for_user_id) のリアクションだけが confirm 扱い
-- ・確定したらみかんが新しい「📅 予定カード」メッセージを投稿し、events 行をそれに紐づける
-- ・有効期限切れの提案は status='expired' に自動更新して何もしない

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
BEGIN
  -- リアクションされたメッセージが pending な提案か?
  SELECT * INTO v_proposal FROM public.event_proposals
    WHERE message_id = NEW.message_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- 提案を頼んだ本人かチェック
  IF NEW.user_id IS DISTINCT FROM v_proposal.for_user_id THEN
    RETURN NEW;
  END IF;

  -- 期限切れチェック (7日間放置されたものは確定させない)
  IF v_proposal.expires_at < NOW() THEN
    UPDATE public.event_proposals
      SET status = 'expired'
      WHERE id = v_proposal.id;
    RETURN NEW;
  END IF;

  -- 確定したイベントカード用のメッセージ本文を組み立て
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

  -- みかんから「📅 ...」メッセージを投稿 (フロントの EventDisplay が拾う形式)
  INSERT INTO public.messages (channel_id, user_id, content)
    VALUES (v_proposal.channel_id, v_proposal.proposed_by, v_event_msg_content)
    RETURNING id INTO v_event_msg_id;

  -- events 行を作成して新しいメッセージに紐づける
  INSERT INTO public.events (
    message_id, channel_id, created_by, title, start_at, location, attendee_ids
  ) VALUES (
    v_event_msg_id,
    v_proposal.channel_id,
    v_proposal.for_user_id,
    v_proposal.title,
    v_proposal.starts_at,
    v_proposal.location,
    '{}'
  )
  RETURNING id INTO v_event_id;

  -- 提案を確定済みに更新
  UPDATE public.event_proposals
    SET status = 'confirmed', confirmed_event_id = v_event_id
    WHERE id = v_proposal.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 何かあってもリアクション自体は成立させる (トリガー失敗で UPDATE が
    -- ロールバックすると、リアクションが付かない不可解な挙動になるため)
    RAISE WARNING 'handle_event_proposal_reaction failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reactions_event_proposal_trigger ON public.reactions;
CREATE TRIGGER reactions_event_proposal_trigger
  AFTER INSERT ON public.reactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_event_proposal_reaction();
