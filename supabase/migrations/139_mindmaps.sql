-- マインドマップ機能
CREATE TABLE public.mindmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  nodes JSONB NOT NULL DEFAULT '[]',
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id)
);

ALTER TABLE public.mindmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mindmaps_select" ON public.mindmaps FOR SELECT USING (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = mindmaps.channel_id AND user_id = auth.uid())
);
CREATE POLICY "mindmaps_insert" ON public.mindmaps FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = mindmaps.channel_id AND user_id = auth.uid())
);
CREATE POLICY "mindmaps_update" ON public.mindmaps FOR UPDATE USING (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = mindmaps.channel_id AND user_id = auth.uid())
);
