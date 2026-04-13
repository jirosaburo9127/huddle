-- レート制限（スパム・ブルートフォース対策）
-- クライアント側の挙動を信用せず DB 側で enforce する。
-- 既存テーブルの created_at / user_id をそのまま使うので追加テーブルは不要。

-- 高速カウントのためユーザー別の直近ウィンドウ用インデックスを追加
CREATE INDEX IF NOT EXISTS idx_messages_user_created_at
  ON public.messages(user_id, created_at DESC);

-- ==========================================
-- 1. メッセージ送信レート制限
-- 10秒あたり 20件まで（通常の会話は余裕、ボット・スパムだけブロック）
-- ==========================================
CREATE OR REPLACE FUNCTION public.enforce_message_rate()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INT;
BEGIN
  -- 自分が直近10秒に送ったメッセージ数をカウント（parent_id問わず、削除済み含む）
  SELECT COUNT(*) INTO recent_count
  FROM public.messages
  WHERE user_id = NEW.user_id
    AND created_at > NOW() - INTERVAL '10 seconds';

  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'rate_limit_exceeded: メッセージの送信頻度が高すぎます。少し時間を置いてください。'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_message_rate ON public.messages;
CREATE TRIGGER trg_enforce_message_rate
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_rate();

-- ==========================================
-- 2. リアクション連打制限
-- 1分あたり 100件まで（普通の使い方ではまず当たらない）
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_reactions_user_created_at
  ON public.reactions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_reaction_rate()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.reactions
  WHERE user_id = NEW.user_id
    AND created_at > NOW() - INTERVAL '1 minute';

  IF recent_count >= 100 THEN
    RAISE EXCEPTION 'rate_limit_exceeded: リアクションの連打が制限を超えました。'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_reaction_rate ON public.reactions;
CREATE TRIGGER trg_enforce_reaction_rate
  BEFORE INSERT ON public.reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reaction_rate();

-- ==========================================
-- 3. 招待作成制限（招待スパム防止）
-- 1時間あたり 30件まで
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_inviter_created_at
  ON public.workspace_invitations(created_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_invitation_rate()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.workspace_invitations
  WHERE created_by = NEW.created_by
    AND created_at > NOW() - INTERVAL '1 hour';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded: 短時間に多くの招待を作成できません。'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_invitation_rate ON public.workspace_invitations;
CREATE TRIGGER trg_enforce_invitation_rate
  BEFORE INSERT ON public.workspace_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invitation_rate();

-- ==========================================
-- 4. チャンネル作成制限（1ユーザー/1日 50件まで）
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_channels_created_by_created_at
  ON public.channels(created_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_channel_rate()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INT;
BEGIN
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO recent_count
  FROM public.channels
  WHERE created_by = NEW.created_by
    AND created_at > NOW() - INTERVAL '1 day';

  IF recent_count >= 50 THEN
    RAISE EXCEPTION 'rate_limit_exceeded: 1日のチャンネル作成上限に達しました。'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_channel_rate ON public.channels;
CREATE TRIGGER trg_enforce_channel_rate
  BEFORE INSERT ON public.channels
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_channel_rate();
