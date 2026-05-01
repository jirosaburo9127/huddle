-- みかん bot の display_name と is_bot を正しい値に修正
-- 062 では handle_new_user トリガが先に email prefix から display_name="mikan-bot" を入れてしまい、
-- 私の IF NOT EXISTS な profiles INSERT が skip されたため修正されなかった。

UPDATE public.profiles
SET display_name = 'みかん',
    is_bot = TRUE
WHERE id = '00000000-0000-0000-0000-00000000aaaa';
