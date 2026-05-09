-- 一時: Database Webhook (supabase_functions.hooks) の現状を Service Role で覗く RPC
-- 通知が一部ワークスペースで来ない原因を切り分けるための診断用。
-- 検証後 102 で DROP する。
CREATE OR REPLACE FUNCTION public.diag_inspect_webhooks()
RETURNS TABLE(
  hook_table_id integer,
  hook_name text,
  hook_function_name text,
  request_id bigint,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = supabase_functions, public
AS $$
  SELECT id::int, hook_table_id::text, hook_name::text, NULL::bigint, NULL::timestamptz
  FROM supabase_functions.hooks
  ORDER BY id;
$$;

-- 直近の net.http_response から send-push 関連を見る (URL に functions/v1/send-push を含む)
CREATE OR REPLACE FUNCTION public.diag_recent_send_push_responses()
RETURNS TABLE(
  id bigint,
  status_code integer,
  created timestamptz,
  content_excerpt text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = net, public
AS $$
  SELECT
    r.id,
    r.status_code,
    r.created,
    LEFT(r.content::text, 200) AS content_excerpt
  FROM net._http_response r
  WHERE r.created > now() - interval '24 hours'
  ORDER BY r.created DESC
  LIMIT 30;
$$;
