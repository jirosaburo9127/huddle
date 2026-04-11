-- チャンネルは「招待された人だけが見られる」仕様に統一
--
-- 以前の channels_select は「ワークスペースメンバー & (公開 OR チャンネルメンバー)」
-- だったため、公開チャンネルはワークスペースの全員から見えていた。
-- 今後は公開/非公開の区別なく、channel_members に入っている人だけがそのチャンネルを
-- 一覧・閲覧できる。新しいチャンネルを誰かに見せたい場合は明示的に招待する運用にする。
--
-- 再帰回避のため 007 で作った is_channel_member(SECURITY DEFINER) を使う。

DROP POLICY IF EXISTS "channels_select" ON public.channels;
CREATE POLICY "channels_select" ON public.channels
  FOR SELECT USING (
    public.is_channel_member(id, auth.uid())
  );
