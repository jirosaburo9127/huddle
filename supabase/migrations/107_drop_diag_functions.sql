-- 診断用 RPC のクリーンアップ。push 通知のワークスペース別不安定問題の調査で使った関数群。
-- 結論: トリガーは1件のみで全WSに対し正常発火。net._http_response の保持期間が短いだけで実際には毎回発火していた。
-- supabase_functions.hooks は設定ではなく発火ログ (約9230件/30日)。問題は別箇所にあったため、診断関数は不要になった。
DROP FUNCTION IF EXISTS public.diag_inspect_webhooks();
DROP FUNCTION IF EXISTS public.diag_recent_send_push_responses();
DROP FUNCTION IF EXISTS public.diag_messages_triggers();
DROP FUNCTION IF EXISTS public.diag_send_push_trigger_args();
DROP FUNCTION IF EXISTS public.diag_send_push_trigger_full();
DROP FUNCTION IF EXISTS public.diag_hooks_schema();
DROP FUNCTION IF EXISTS public.diag_hooks_count_and_recent();
