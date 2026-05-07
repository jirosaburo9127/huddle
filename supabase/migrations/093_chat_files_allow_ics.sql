-- chat-files バケットの allowed_mime_types に text/calendar (.ics) を追加。
-- カレンダーイベントファイルをチャットに添付できるようにする。

UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'text/calendar')
WHERE name = 'chat-files'
  AND NOT ('text/calendar' = ANY(allowed_mime_types));
