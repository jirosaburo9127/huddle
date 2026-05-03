-- みかんが「予定登録を提案する」状態を保留しておくテーブル。
-- ユーザーがリアクションを付けたら、トリガー側で events に変換する。
-- 流れ:
--   1) ユーザーがみかん宛にスケジュール意図のあるメッセージを投稿
--   2) Edge Function (mikan-respond) が Anthropic tool use で日時 / タイトルを抽出
--   3) Edge Function がみかんの「提案メッセージ」を投稿 + event_proposals に行を保存
--   4) ユーザーがその提案メッセージにリアクション → トリガー (072) で events に変換

CREATE TABLE IF NOT EXISTS public.event_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  -- 提案メッセージの ID。リアクションのトリガーで照合する
  message_id UUID NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  -- 提案を出したのは誰か (普通はみかん bot)
  proposed_by UUID NOT NULL REFERENCES public.profiles(id),
  -- 「この予定を入れたい」と頼んだユーザー (このユーザーのリアクションだけが confirm 扱い)
  for_user_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired')),
  confirmed_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_proposals_message ON public.event_proposals(message_id);
CREATE INDEX IF NOT EXISTS idx_event_proposals_status ON public.event_proposals(status);

-- RLS: ワークスペースメンバーなら閲覧可。INSERT は SECURITY DEFINER 経由のみ。
ALTER TABLE public.event_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposals_select" ON public.event_proposals;
CREATE POLICY "proposals_select" ON public.event_proposals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = event_proposals.workspace_id AND user_id = auth.uid()
    )
  );

-- 日時を日本語表記にフォーマットする小さなユーティリティ。
-- フロントの formatDateTimeJa と揃える形式: "5月4日(土) 15:00"
CREATE OR REPLACE FUNCTION public._format_dt_ja(ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  jst TIMESTAMP;
  dow TEXT;
BEGIN
  jst := ts AT TIME ZONE 'Asia/Tokyo';
  dow := CASE EXTRACT(DOW FROM jst)::INT
    WHEN 0 THEN '日'
    WHEN 1 THEN '月'
    WHEN 2 THEN '火'
    WHEN 3 THEN '水'
    WHEN 4 THEN '木'
    WHEN 5 THEN '金'
    WHEN 6 THEN '土'
  END;
  RETURN format('%s月%s日(%s) %s:%s',
    EXTRACT(MONTH FROM jst)::INT,
    EXTRACT(DAY FROM jst)::INT,
    dow,
    LPAD(EXTRACT(HOUR FROM jst)::TEXT, 2, '0'),
    LPAD(EXTRACT(MINUTE FROM jst)::TEXT, 2, '0')
  );
END;
$$;
