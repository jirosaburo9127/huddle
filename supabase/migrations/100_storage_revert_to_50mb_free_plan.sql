-- Free プランは Global file size limit が 50MB に固定されており、バケット側で 1GB に上げても無効。
-- migration 099 で 1GB に上げたが Free プラン上は意味を成さないため、整合性のため 50MB に戻す。
-- Pro プラン移行時は Dashboard の「Global file size limit」を上げた後、バケット側も上限を再設定すること。
UPDATE storage.buckets
SET file_size_limit = 52428800 -- 50 MB
WHERE id = 'chat-files';
