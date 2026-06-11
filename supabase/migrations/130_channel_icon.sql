-- チャンネルアイコン画像URL カラムを追加
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS icon_url TEXT;
