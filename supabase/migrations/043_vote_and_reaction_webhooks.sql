-- リアクションと投票回答の通知トリガーを再構築
-- supabase_functions.http_request 方式に統一

-- ==========================================
-- リアクション通知トリガー（再構築）
-- ==========================================
drop trigger if exists trigger_reaction_push on public.reactions;
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

-- ==========================================
-- 投票回答通知トリガー（新規）
-- ==========================================
drop trigger if exists trigger_vote_push on public.poll_votes;
create trigger trigger_vote_push
  after insert on public.poll_votes
  for each row
  execute function supabase_functions.http_request(
    'https://emfngqketrieioxusuhg.supabase.co/functions/v1/send-vote-push',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );
