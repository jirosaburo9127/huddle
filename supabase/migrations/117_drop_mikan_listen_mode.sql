-- みかんの自動見守りモード (Mode B / listen) を撤去する。
--
-- 経緯:
--   073_mikan_listen_mode.sql で messages テーブル INSERT を起点に
--   mikan-respond Edge Function を listen モードで呼び、LLM が文脈から
--   日時を推測して自動で予定提案するモードを追加した。
--   しかし「保険フィルタ禁止」方針に反し、コード側で重複防止・場所未確認 skip・
--   過去日 skip・日時不明 skip などの後付けバリデーションを積む方向に
--   走ってしまっていた。
--
--   ユーザー要求起点 (Mode A / mention) では判断主体がユーザーなので、
--   LLM がポンコツでもユーザーがその場で訂正できる。自動モードは廃止し、
--   Mode A のシステムプロンプトで「場所未確認・過去日・日時不明 は確認質問を
--   返す」を明示する方針へ切り替える (Edge Function 側で対応済み)。

DROP TRIGGER IF EXISTS messages_mikan_listen_trigger ON public.messages;
DROP FUNCTION IF EXISTS public.notify_mikan_listen();
