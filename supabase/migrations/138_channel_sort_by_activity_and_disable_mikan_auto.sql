-- チャンネル一覧を最新メッセージ順にソート
-- get_workspace_data RPCのチャンネル取得を ORDER BY ch.name → ORDER BY last_activity DESC に変更
-- （RPC本体はSQL Editorで直接更新済み）

-- みかんの自動投稿を一旦無効化
-- 1. プロアクティブcron停止
SELECT cron.unschedule('mikan-proactive-daily');
-- 2. 盛り上がりトリガー無効化
DROP TRIGGER IF EXISTS trigger_mikan_active_discussion ON public.messages;
