-- 検証用に追加した一時 RPC を削除
DROP FUNCTION IF EXISTS public._test_calendar_filter(UUID, TEXT, INT, INT);
