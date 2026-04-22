-- 30日経過した画像・動画ファイルをStorageから自動削除
-- メッセージ本文からファイルURLを除去し「ファイルの保存期間が終了しました」に置換

-- ファイルクリーンアップ関数
CREATE OR REPLACE FUNCTION public.cleanup_expired_files()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_msg RECORD;
  v_line TEXT;
  v_lines TEXT[];
  v_new_lines TEXT[];
  v_has_file BOOLEAN;
  v_file_path TEXT;
BEGIN
  -- 30日以上前のメッセージでStorage URLを含むものを検索
  FOR v_msg IN
    SELECT id, content
    FROM public.messages
    WHERE created_at < NOW() - INTERVAL '30 days'
      AND deleted_at IS NULL
      AND content LIKE '%supabase%/storage/v1/object/public/chat-files/%'
  LOOP
    v_lines := string_to_array(v_msg.content, E'\n');
    v_new_lines := ARRAY[]::TEXT[];
    v_has_file := FALSE;

    FOREACH v_line IN ARRAY v_lines LOOP
      IF v_line ~ 'https://.*supabase.*/storage/v1/object/public/chat-files/.*\.(jpg|jpeg|png|gif|webp|svg|mp4|mov|webm|m4v)' THEN
        -- 画像・動画URLの行 → Storageから削除
        v_file_path := regexp_replace(
          v_line,
          '^https://[^/]+/storage/v1/object/public/chat-files/',
          ''
        );
        v_file_path := btrim(v_file_path);

        -- Storage APIで削除（pg_netで非同期HTTP）
        IF v_file_path <> '' THEN
          PERFORM net.http_post(
            url := current_setting('app.supabase_url', TRUE) || '/storage/v1/object/chat-files/' || v_file_path,
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.service_role_key', TRUE),
              'Content-Type', 'application/json'
            ),
            body := '{}'::jsonb
          );
        END IF;

        v_new_lines := array_append(v_new_lines, '📁 ファイルの保存期間（30日）が終了しました');
        v_has_file := TRUE;
      ELSE
        v_new_lines := array_append(v_new_lines, v_line);
      END IF;
    END LOOP;

    -- ファイルURLがあった場合のみメッセージを更新
    IF v_has_file THEN
      UPDATE public.messages
      SET content = array_to_string(v_new_lines, E'\n')
      WHERE id = v_msg.id;
    END IF;
  END LOOP;
END;
$$;

-- pg_cronで毎日AM4時に実行（バックアップの1時間後）
-- ※ pg_cronはSupabase Proで利用可能。Freeプランの場合は手動実行
SELECT cron.schedule(
  'cleanup-expired-files',
  '0 19 * * *',  -- UTC 19:00 = JST 4:00
  $$SELECT public.cleanup_expired_files()$$
);
