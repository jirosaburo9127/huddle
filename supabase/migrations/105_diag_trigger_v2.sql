-- pg_get_triggerdef を pretty=true で全文取得
CREATE OR REPLACE FUNCTION public.diag_send_push_trigger_full()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'messages'
    AND t.tgname = 'send-push-on-public-message'
  LIMIT 1;
$$;
