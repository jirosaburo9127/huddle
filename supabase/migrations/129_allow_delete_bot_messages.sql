-- みかん（bot）のメッセージは誰でもソフトデリート（deleted_at更新）できるようにする
-- 通常メッセージの UPDATE/DELETE は引き続き投稿者本人のみ

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = messages.user_id AND is_bot = true
    )
  );

DROP POLICY IF EXISTS "messages_delete" ON public.messages;
CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = messages.user_id AND is_bot = true
    )
  );
