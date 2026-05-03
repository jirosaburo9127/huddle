-- 074 で追加したデバッグ用 RPC は調査が済んだので削除する
-- (auth ヘッダ問題の原因確認に使ったが、本番には不要)

DROP FUNCTION IF EXISTS public._debug_mikan_state();
