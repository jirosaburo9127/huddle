-- SVG をストレージ側の許可 MIME から削除
-- SVG は <script> 要素を埋め込めるため、同一オリジンでホストすると XSS ベクトルになる。
-- 020 で許可リストに入れていたが、ブラウザで直接表示される可能性を考え削除する。

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'application/xml',
  'text/xml'
]
WHERE id = 'chat-files';
