-- 監査ログテーブル
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON public.audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- owner/adminのみ閲覧可能
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = audit_logs.workspace_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- 挿入は全ユーザー（トリガー経由）
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- メッセージ送信の監査ログトリガー
CREATE OR REPLACE FUNCTION log_message_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.audit_logs (workspace_id, user_id, action, target_type, target_id)
  SELECT c.workspace_id, NEW.user_id, 'message_sent', 'message', NEW.id::text
  FROM channels c WHERE c.id = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_message_insert ON public.messages;
CREATE TRIGGER audit_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION log_message_insert();

-- メンバー参加の監査ログトリガー
CREATE OR REPLACE FUNCTION log_member_join()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.audit_logs (workspace_id, user_id, action, target_type, target_id)
  VALUES (NEW.workspace_id, NEW.user_id, 'member_joined', 'workspace', NEW.workspace_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_member_join ON public.workspace_members;
CREATE TRIGGER audit_member_join
  AFTER INSERT ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION log_member_join();

-- チャンネル作成の監査ログトリガー
CREATE OR REPLACE FUNCTION log_channel_create()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.audit_logs (workspace_id, user_id, action, target_type, target_id)
  VALUES (NEW.workspace_id, NEW.created_by, 'channel_created', 'channel', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_channel_create ON public.channels;
CREATE TRIGGER audit_channel_create
  AFTER INSERT ON public.channels
  FOR EACH ROW EXECUTE FUNCTION log_channel_create();

-- チャンネル削除の監査ログトリガー
CREATE OR REPLACE FUNCTION log_channel_delete()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.audit_logs (workspace_id, user_id, action, target_type, target_id, metadata)
  VALUES (OLD.workspace_id, auth.uid(), 'channel_deleted', 'channel', OLD.id::text, jsonb_build_object('name', OLD.name));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_channel_delete ON public.channels;
CREATE TRIGGER audit_channel_delete
  BEFORE DELETE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION log_channel_delete();
