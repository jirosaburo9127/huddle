CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer,
  use_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.workspace_invitations(token);

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_select" ON public.workspace_invitations
  FOR SELECT USING (
    exists (select 1 from public.workspace_members where workspace_id = workspace_invitations.workspace_id and user_id = auth.uid())
  );

CREATE POLICY "invitations_insert" ON public.workspace_invitations
  FOR INSERT WITH CHECK (
    exists (select 1 from public.workspace_members where workspace_id = workspace_invitations.workspace_id and user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS JSON AS $$
DECLARE
  v_invitation record;
  v_workspace record;
  v_user_id uuid;
  v_general_channel_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invitation FROM public.workspace_invitations
    WHERE token = p_token AND is_active = true AND expires_at > now()
    AND (max_uses IS NULL OR use_count < max_uses);

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_or_expired');
  END IF;

  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = v_invitation.workspace_id AND user_id = v_user_id) THEN
    SELECT slug INTO v_workspace FROM public.workspaces WHERE id = v_invitation.workspace_id;
    RETURN json_build_object('status', 'already_member', 'workspace_slug', v_workspace.slug);
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_invitation.workspace_id, v_user_id, 'member');

  SELECT id INTO v_general_channel_id FROM public.channels
    WHERE workspace_id = v_invitation.workspace_id AND slug = 'general' LIMIT 1;

  IF v_general_channel_id IS NOT NULL THEN
    INSERT INTO public.channel_members (channel_id, user_id) VALUES (v_general_channel_id, v_user_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.workspace_invitations SET use_count = use_count + 1 WHERE id = v_invitation.id;

  SELECT slug INTO v_workspace FROM public.workspaces WHERE id = v_invitation.workspace_id;
  RETURN json_build_object('status', 'joined', 'workspace_slug', v_workspace.slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_invitation_info(p_token text)
RETURNS JSON AS $$
DECLARE
  v_result record;
BEGIN
  SELECT w.name as workspace_name, w.slug as workspace_slug
  INTO v_result
  FROM public.workspace_invitations i
  JOIN public.workspaces w ON w.id = i.workspace_id
  WHERE i.token = p_token AND i.is_active = true AND i.expires_at > now()
    AND (i.max_uses IS NULL OR i.use_count < i.max_uses);

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_or_expired');
  END IF;

  RETURN json_build_object('workspace_name', v_result.workspace_name, 'workspace_slug', v_result.workspace_slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
