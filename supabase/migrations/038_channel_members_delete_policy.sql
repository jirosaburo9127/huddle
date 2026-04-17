-- channel_members の DELETE ポリシーが未定義だったため、
-- メンバー管理画面からチャンネルメンバーを削除できなかった。
-- 同じチャンネルに所属しているメンバーなら他メンバーを削除可能にする。

DROP POLICY IF EXISTS "channel_members_delete" ON public.channel_members;
CREATE POLICY "channel_members_delete" ON public.channel_members
  FOR DELETE USING (
    -- 自分自身の脱退、または同チャンネルのメンバーが他メンバーを削除
    EXISTS (
      SELECT 1 FROM public.channel_members cm
      WHERE cm.channel_id = channel_members.channel_id
        AND cm.user_id = auth.uid()
    )
  );
