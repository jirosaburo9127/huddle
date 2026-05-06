CREATE OR REPLACE FUNCTION public._inspect_func_def(fn_name TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
SELECT pg_get_functiondef(oid)
FROM pg_proc WHERE proname = fn_name LIMIT 1;
$$;
