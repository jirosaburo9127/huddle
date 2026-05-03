-- 一時デバッグ用: pg_net 直近 / cron job 状態を見る
CREATE OR REPLACE FUNCTION public._debug_push_state()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, cron, pg_temp
AS $$
DECLARE
  v_responses JSON;
  v_jobs JSON;
  v_runs JSON;
BEGIN
  -- 直近 pg_net レスポンス
  BEGIN
    SELECT json_agg(row_to_json(r) ORDER BY r.created DESC) INTO v_responses
    FROM (
      SELECT id, status_code, created, LEFT(COALESCE(content,''), 150) AS content
      FROM net._http_response ORDER BY created DESC LIMIT 15
    ) r;
  EXCEPTION WHEN OTHERS THEN
    v_responses := json_build_object('error', SQLERRM);
  END;

  -- cron ジョブ
  BEGIN
    SELECT json_agg(row_to_json(j)) INTO v_jobs
    FROM (
      SELECT jobid, schedule, command, jobname, active
      FROM cron.job WHERE jobname = 'fire-event-reminders'
    ) j;
  EXCEPTION WHEN OTHERS THEN
    v_jobs := json_build_object('error', SQLERRM);
  END;

  -- cron 実行履歴
  BEGIN
    SELECT json_agg(row_to_json(r) ORDER BY r.start_time DESC) INTO v_runs
    FROM (
      SELECT runid, jobid, start_time, end_time, status, return_message
      FROM cron.job_run_details
      WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'fire-event-reminders')
      ORDER BY start_time DESC LIMIT 5
    ) r;
  EXCEPTION WHEN OTHERS THEN
    v_runs := json_build_object('error', SQLERRM);
  END;

  RETURN json_build_object(
    'recent_pg_net_responses', v_responses,
    'cron_job', v_jobs,
    'cron_recent_runs', v_runs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._debug_push_state() TO service_role, authenticated;
