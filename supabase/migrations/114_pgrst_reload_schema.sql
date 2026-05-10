-- 112 で大量の RPC を plpgsql に書き換えたので、PostgREST の schema cache を
-- 強制リロードする (シグネチャ変更時に古いキャッシュを掴んだままになる事故対策)。
NOTIFY pgrst, 'reload schema';
