-- Storage: chat-files バケットのUPDATEポリシーを追加
-- upsert: true でのアイコン上書きに必要
DROP POLICY IF EXISTS "storage_chat_files_update" ON storage.objects;
CREATE POLICY "storage_chat_files_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'chat-files' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'chat-files' AND auth.uid() IS NOT NULL);
