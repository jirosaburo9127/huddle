-- 一時的なデバッグ用 RPC: pg_net の最近のレスポンスとトリガー状態を確認する
-- 確認終了後に削除する予定

CREATE OR REPLACE FUNCTION public._debug_mikan_state()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_triggers JSON;
  v_recent_responses JSON;
  v_recent_requests JSON;
BEGIN
  -- 1) トリガー一覧 (messages, mentions, reactions)
  SELECT json_agg(json_build_object(
    'trigger', tgname,
    'table', relname,
    'function', proname,
    'enabled', tgenabled
  )) INTO v_triggers
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE c.relname IN ('messages', 'mentions', 'reactions')
    AND NOT tgisinternal;

  -- 2) pg_net 最近のレスポンス (直近 20 件)
  BEGIN
    SELECT json_agg(json_build_object(
      'id', id,
      'status_code', status_code,
      'created', created,
      'content_short', LEFT(COALESCE(content, ''), 200)
    ) ORDER BY created DESC) INTO v_recent_responses
    FROM (
      SELECT id, status_code, created, content
      FROM net._http_response
      ORDER BY created DESC
      LIMIT 20
    ) sub;
  EXCEPTION WHEN OTHERS THEN
    v_recent_responses := json_build_object('error', SQLERRM);
  END;

  -- 3) pg_net 最近のリクエスト (直近 20 件)
  BEGIN
    SELECT json_agg(json_build_object(
      'id', id,
      'method', method,
      'url', url,
      'created', created
    ) ORDER BY created DESC) INTO v_recent_requests
    FROM (
      SELECT id, method, url, created
      FROM net.http_request_queue
      ORDER BY created DESC
      LIMIT 20
    ) sub;
  EXCEPTION WHEN OTHERS THEN
    v_recent_requests := json_build_object('error', SQLERRM);
  END;

  RETURN json_build_object(
    'triggers', v_triggers,
    'recent_responses', v_recent_responses,
    'recent_requests', v_recent_requests
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._debug_mikan_state() TO authenticated, service_role;
