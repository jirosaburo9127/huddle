-- タスク担当者アサイン時のプッシュ通知
--
-- task_assignees への INSERT 時に send-task-push Edge Function を呼ぶ。
-- 041_reaction_push_webhook.sql と同型 (pg_net で非同期 HTTP POST)。
--
-- 通知は「他人を担当に割り当てた」時だけ。自分自身へのアサインは飛ばさない。
-- ※ 二重通知防止のため、編集時のアサイン差し替えはクライアント側で
--   「増えた担当者だけ INSERT / 減った担当者だけ DELETE」の差分更新にすること
--   (task-modal.tsx)。全削除→全再INSERT すると毎回通知が飛ぶため。

CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_url TEXT;
  v_payload JSONB;
BEGIN
  -- 自分自身へのアサインは通知しない
  IF NEW.user_id = v_actor THEN
    RETURN NEW;
  END IF;

  v_url := 'https://emfngqketrieioxusuhg.supabase.co/functions/v1/send-task-push';

  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'task_assignees',
    'record', jsonb_build_object(
      'task_id', NEW.task_id,
      'user_id', NEW.user_id,
      'actor_id', v_actor
    )
  );

  PERFORM net.http_post(
    url := v_url,
    body := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_task_assignment ON public.task_assignees;
CREATE TRIGGER trigger_task_assignment
  AFTER INSERT ON public.task_assignees
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assignment();
