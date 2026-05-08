-- ファイルサイズ上限を 50MB → 1GB に引き上げ（画面収録・長尺動画・大容量PDFに対応）
-- 1GB = 1024 * 1024 * 1024 = 1073741824 bytes
UPDATE storage.buckets
SET file_size_limit = 1073741824
WHERE id = 'chat-files';
