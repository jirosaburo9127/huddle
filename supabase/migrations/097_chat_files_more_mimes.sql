-- chat-files バケットの allowed_mime_types に音声・画像追加・iWork・追加圧縮・
-- 電子書籍・地図 (KML/GPX) などを許可する。
-- HTML (text/html) は XSS リスクのため意図的に追加しない。
-- SVG (image/svg+xml) も XSS リスクのため追加しない。

DO $$
DECLARE
  new_mimes TEXT[] := ARRAY[
    -- 画像追加
    'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    -- 音声
    'audio/mpeg', 'audio/wav', 'audio/x-wav',
    'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
    -- Apple iWork
    'application/vnd.apple.pages',
    'application/vnd.apple.numbers',
    'application/vnd.apple.keynote',
    -- テキスト系追加
    'text/markdown', 'application/x-yaml', 'text/yaml',
    -- 圧縮追加
    'application/vnd.rar', 'application/x-rar-compressed',
    'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
    -- 電子書籍
    'application/epub+zip', 'application/x-mobipocket-ebook',
    -- 地図
    'application/vnd.google-earth.kml+xml', 'application/gpx+xml'
  ];
  m TEXT;
BEGIN
  FOREACH m IN ARRAY new_mimes LOOP
    UPDATE storage.buckets
       SET allowed_mime_types = array_append(allowed_mime_types, m)
     WHERE name = 'chat-files'
       AND NOT (m = ANY(allowed_mime_types));
  END LOOP;
END $$;
