-- チャンネルメンバーがicon_url等を更新できるようにするUPDATEポリシー
DROP POLICY IF EXISTS "channels_update_icon" ON public.channels;
CREATE POLICY "channels_update_icon" ON public.channels
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.channel_members
      WHERE channel_id = channels.id AND user_id = auth.uid()
    )
  );
