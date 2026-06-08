-- update_event のオーバーロード重複を解消
-- 4引数版 (attendee_ids なし) が残っていて、
-- PostgREST がそちらにマッチすると参加者更新が無視される問題を修正。
-- 5引数版 (attendee_ids あり) だけを残す。

DROP FUNCTION IF EXISTS public.update_event(uuid, text, timestamptz, text);
