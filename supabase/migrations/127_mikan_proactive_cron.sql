-- みかんプロアクティブ介入: 毎日 10:00 JST (01:00 UTC) に
-- mikan_enabled チャンネルの停滞チェックを実行する cron ジョブ

SELECT cron.schedule(
  'mikan-proactive-daily',
  '0 1 * * *',
  $$
  SELECT net.http_post(
    url := 'https://emfngqketrieioxusuhg.supabase.co/functions/v1/mikan-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Mikan-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mikan_webhook_secret')
    ),
    body := '{"trigger": "proactive_daily"}'::jsonb
  );
  $$
);
