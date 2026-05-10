-- migration 110-111 の診断 RPC をクリーンアップ
DROP FUNCTION IF EXISTS public.diag_list_p_user_id_rpcs();
DROP FUNCTION IF EXISTS public.diag_get_function_def(text);
