-- supabase_functions.hooks のスキーマと総レコード数を確認
CREATE OR REPLACE FUNCTION public.diag_hooks_schema()
RETURNS TABLE(
  column_name text,
  data_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = information_schema, public
AS $$
  SELECT column_name::text, data_type::text
  FROM information_schema.columns
  WHERE table_schema = 'supabase_functions'
    AND table_name = 'hooks'
  ORDER BY ordinal_position;
$$;

CREATE OR REPLACE FUNCTION public.diag_hooks_count_and_recent()
RETURNS TABLE(
  total_count bigint,
  oldest timestamptz,
  newest timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = supabase_functions, public
AS $$
  SELECT COUNT(*)::bigint, MIN(created_at), MAX(created_at)
  FROM supabase_functions.hooks;
$$;
