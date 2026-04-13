-- chat-files バケットにサーバ側でもサイズ・MIME制限を適用
-- クライアント側の検証は信用できないので、Storage側で同じ制約を enforce する。
-- これで悪意あるクライアントが直接 Storage API を叩いても弾かれる。

UPDATE storage.buckets
SET
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
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
