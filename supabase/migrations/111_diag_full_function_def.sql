-- カテゴリA関数のフル定義を取得するための診断 RPC
CREATE OR REPLACE FUNCTION public.diag_get_function_def(p_function_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_function_name
  LIMIT 1;
$$;
