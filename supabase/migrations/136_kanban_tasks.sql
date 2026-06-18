-- カンバンボード型タスク管理

-- タスクテーブル
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 担当者テーブル（多対多）
CREATE TABLE public.task_assignees (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_tasks_channel ON public.tasks(channel_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_task_assignees_user ON public.task_assignees(user_id);

-- RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = tasks.channel_id AND user_id = auth.uid())
);
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = tasks.channel_id AND user_id = auth.uid())
  AND created_by = auth.uid()
);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (
  EXISTS (SELECT 1 FROM channel_members WHERE channel_id = tasks.channel_id AND user_id = auth.uid())
);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (
  created_by = auth.uid()
);

CREATE POLICY "task_assignees_select" ON public.task_assignees FOR SELECT USING (
  EXISTS (SELECT 1 FROM tasks t JOIN channel_members cm ON cm.channel_id = t.channel_id WHERE t.id = task_assignees.task_id AND cm.user_id = auth.uid())
);
CREATE POLICY "task_assignees_insert" ON public.task_assignees FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tasks t JOIN channel_members cm ON cm.channel_id = t.channel_id WHERE t.id = task_assignees.task_id AND cm.user_id = auth.uid())
);
CREATE POLICY "task_assignees_delete" ON public.task_assignees FOR DELETE USING (
  EXISTS (SELECT 1 FROM tasks t JOIN channel_members cm ON cm.channel_id = t.channel_id WHERE t.id = task_assignees.task_id AND cm.user_id = auth.uid())
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

-- マイタスク取得RPC（完了以外）
CREATE OR REPLACE FUNCTION public.get_my_tasks(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN (
    SELECT COALESCE(json_agg(sub ORDER BY sub.sort_order, sub.created_at), '[]'::json)
    FROM (
      SELECT t.id, t.title, t.description, t.status, t.due_date, t.sort_order,
        t.channel_id, t.created_by, t.created_at, t.updated_at,
        json_build_object('name', c.name, 'slug', c.slug, 'icon_url', c.icon_url) AS channel,
        json_build_object('display_name', p.display_name, 'avatar_url', p.avatar_url) AS creator,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'user_id', ta.user_id,
            'display_name', ap.display_name,
            'avatar_url', ap.avatar_url
          )), '[]'::json)
          FROM task_assignees ta
          JOIN profiles ap ON ap.id = ta.user_id
          WHERE ta.task_id = t.id
        ) AS assignees
      FROM tasks t
      JOIN channels c ON c.id = t.channel_id
      JOIN profiles p ON p.id = t.created_by
      WHERE EXISTS (
        SELECT 1 FROM channel_members cm
        WHERE cm.channel_id = t.channel_id AND cm.user_id = p_user_id
      )
      ORDER BY t.sort_order, t.created_at
    ) sub
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_tasks(UUID) TO authenticated;
