-- セキュリティレビュー用診断: p_user_id を引数に持つ public schema の関数を列挙
CREATE OR REPLACE FUNCTION public.diag_list_p_user_id_rpcs()
RETURNS TABLE(
  function_name text,
  arg_signature text,
  is_security_definer boolean,
  source_excerpt text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    p.proname::text AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arg_signature,
    p.prosecdef AS is_security_definer,
    LEFT(pg_get_functiondef(p.oid), 350) AS source_excerpt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_get_function_identity_arguments(p.oid) ILIKE '%p_user_id%'
  ORDER BY p.proname;
$$;
