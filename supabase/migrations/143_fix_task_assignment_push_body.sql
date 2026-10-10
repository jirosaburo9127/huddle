-- タスク担当者アサイン通知の修正
--
-- 142 の notify_task_assignment() は net.http_post の body に text を渡していたが、
-- pg_net の http_post は body が jsonb。該当シグネチャが無く
--   function net.http_post(url => text, body => text, headers => jsonb) does not exist
-- で失敗し、トリガーごと task_assignees への INSERT がロールバックされていた
-- （他人を担当に割り当てると無言で失敗、本番の task_assignees が 0 行のままだった）。
--
-- 修正: body を jsonb のまま渡す。あわせて、通知の送信に失敗しても
-- 担当の割り当て自体は成立させる（失敗は WARNING としてログに残す）。

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

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := v_payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(current_setting('supabase.service_role_key', true), '')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_task_assignment: push 送信に失敗 (task_id=%, user_id=%): %', NEW.task_id, NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
