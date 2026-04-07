DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;
CREATE POLICY "workspace_members_insert" ON public.workspace_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "channel_members_insert" ON public.channel_members;
CREATE POLICY "channel_members_insert" ON public.channel_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channels c
      JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
      WHERE c.id = channel_members.channel_id AND wm.user_id = auth.uid()
    )
  );
