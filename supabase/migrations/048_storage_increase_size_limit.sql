-- 動画対応のためファイルサイズ上限を引き上げ（10MB → 50MB）
UPDATE storage.buckets
SET file_size_limit = 52428800 -- 50 MB
WHERE id = 'chat-files';
