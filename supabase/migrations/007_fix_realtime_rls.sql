-- ═══════════════════════════════════════════════
-- Realtime postgres_changes 配信問題の修正
-- ═══════════════════════════════════════════════
--
-- 問題:
--   channel_members_select の RLS ポリシーが channel_members 自体を
--   再帰的に参照しているため、Supabase Realtime postgres_changes が
--   recipient セッションで messages_select を評価する際の subquery で
--   失敗し、メッセージイベントが配信されない。
--
-- 解決:
--   1) channel_members の RLS チェック用 SECURITY DEFINER ヘルパー関数を作成
--      (RLS をバイパスして再帰を断ち切る)
--   2) channel_members / messages / reactions / mentions / files 等の
--      関連ポリシーを、ヘルパー経由に書き換え

-- ヘルパー関数: あるユーザーがあるチャンネルのメンバーかを判定（RLSバイパス）
CREATE OR REPLACE FUNCTION public.is_channel_member(p_channel_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = p_user_id
  );
$$;

-- 既存ポリシーを差し替え

-- channel_members: 自分の行 + 同じチャンネルに自分が居る場合は他メンバーも見える
DROP POLICY IF EXISTS "channel_members_select" ON public.channel_members;
CREATE POLICY "channel_members_select" ON public.channel_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_channel_member(channel_id, auth.uid())
  );

-- messages: 自分がメンバーであるチャンネルのメッセージのみ
DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    public.is_channel_member(channel_id, auth.uid())
  );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_channel_member(channel_id, auth.uid())
  );

-- reactions: メッセージが見える(=チャンネルメンバー)なら見える
DROP POLICY IF EXISTS "reactions_select" ON public.reactions;
CREATE POLICY "reactions_select" ON public.reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = reactions.message_id
        AND public.is_channel_member(m.channel_id, auth.uid())
    )
  );

-- mentions: 同上
DROP POLICY IF EXISTS "mentions_select" ON public.mentions;
CREATE POLICY "mentions_select" ON public.mentions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = mentions.message_id
        AND public.is_channel_member(m.channel_id, auth.uid())
    )
  );

-- files: 同上
DROP POLICY IF EXISTS "files_select" ON public.files;
CREATE POLICY "files_select" ON public.files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = files.message_id
        AND public.is_channel_member(m.channel_id, auth.uid())
    )
  );
