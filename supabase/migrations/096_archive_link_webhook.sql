-- archive-link Edge Function を起動するための Database Webhook (trigger)。
-- messages INSERT ごとに supabase_functions.http_request で Edge Function を呼ぶ。
-- Edge Function 側で verify_jwt=false にしているため Authorization は不要。
-- 早期 return (みかん投稿 / DM / 独り言 / みんなでお勉強自身 / 別 workspace)
-- は Edge Function 側で行う。

DROP TRIGGER IF EXISTS archive_link_on_message ON public.messages;

CREATE TRIGGER archive_link_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  'https://emfngqketrieioxusuhg.supabase.co/functions/v1/archive-link',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);
