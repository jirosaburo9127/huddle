-- メッセージからのタスク化: tasks に元メッセージへの参照を追加
--
-- - tasks.message_id: タスクの元になったメッセージ (任意)。
--   メッセージが消えてもタスクは残す (ON DELETE SET NULL)。
-- - get_my_tasks を message_id も返すよう拡張 (「元投稿へ」導線用)。

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_message ON public.tasks(message_id);

-- get_my_tasks: message_id を出力に追加 (それ以外は 136 と同一)
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
        t.channel_id, t.message_id, t.created_by, t.created_at, t.updated_at,
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
