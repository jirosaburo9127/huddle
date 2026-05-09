-- 一時診断: messages テーブルの全トリガー名と関数を取得
CREATE OR REPLACE FUNCTION public.diag_messages_triggers()
RETURNS TABLE(
  trigger_name text,
  trigger_function text,
  trigger_def text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.tgname::text AS trigger_name,
    p.proname::text AS trigger_function,
    pg_get_triggerdef(t.oid) AS trigger_def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE n.nspname = 'public'
    AND c.relname = 'messages'
    AND NOT t.tgisinternal
  ORDER BY t.tgname;
$$;
