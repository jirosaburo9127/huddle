-- reactions テーブルの INSERT 時に send-reaction-push Edge Function を呼び出す
-- Supabase の Database Webhook (supabase_functions.http_request) を利用

-- トリガー関数: Webhook 経由で Edge Function を呼ぶ
create or replace function public.notify_reaction_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_payload jsonb;
begin
  -- Edge Function の URL を構築
  v_url := current_setting('app.settings.supabase_url', true);
  if v_url is null or v_url = '' then
    v_url := 'https://emfngqketrieioxusuhg.supabase.co';
  end if;
  v_url := v_url || '/functions/v1/send-reaction-push';

  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'reactions',
    'record', jsonb_build_object(
      'id', NEW.id,
      'message_id', NEW.message_id,
      'user_id', NEW.user_id,
      'emoji', NEW.emoji
    )
  );

  -- pg_net で非同期 HTTP POST
  perform net.http_post(
    url := v_url,
    body := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );

  return NEW;
end;
$$;

-- トリガーを作成
drop trigger if exists trigger_reaction_push on public.reactions;
create trigger trigger_reaction_push
  after insert on public.reactions
  for each row
  execute function public.notify_reaction_push();
