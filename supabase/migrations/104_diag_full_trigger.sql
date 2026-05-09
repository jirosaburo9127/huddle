-- pg_get_triggerdef は長文を切る場合がある。
-- pg_trigger.tgargs から直接 raw 引数を取り出す。
CREATE OR REPLACE FUNCTION public.diag_send_push_trigger_args()
RETURNS TABLE(
  trigger_name text,
  args text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.tgname::text,
    -- tgargs は \\000 区切りの bytea。convert + string_to_array で配列化
    string_to_array(
      convert_from(t.tgargs, 'UTF8'),
      chr(0)
    )
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'messages'
    AND t.tgname = 'send-push-on-public-message';
$$;
