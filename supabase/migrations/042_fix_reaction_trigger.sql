-- リアクション通知トリガーを Supabase 標準の Database Webhook 方式に変更
-- pg_net + current_setting('supabase.service_role_key') が環境によって動かないため、
-- supabase_functions.http_request を使う方式に切り替え

-- 旧トリガーと関数を削除
drop trigger if exists trigger_reaction_push on public.reactions;
drop function if exists public.notify_reaction_push();

-- Supabase 標準の Database Webhook トリガー
create trigger trigger_reaction_push
  after insert on public.reactions
  for each row
  execute function supabase_functions.http_request(
    'https://emfngqketrieioxusuhg.supabase.co/functions/v1/send-reaction-push',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );
