-- 決定事項の付帯情報（Why / Due）を messages テーブルに追加
--
-- 差別化機能: 単なるチャットの「ピン留め」ではなく、意思決定を資産として残すための
-- 補足情報を後付けできるようにする。ユーザーは決定ボタンを押した後、任意で「なぜその
-- 決定に至ったか」「いつまでに実行するか」を追記できる。
--
-- - decision_why: 理由・背景・根拠（任意、フリーテキスト）
-- - decision_due: 期限や期日（任意、フリーテキスト。日付以外の「月末まで」等も受ける）
-- どちらも既存行は NULL のまま。UI側で null ならセクションごと非表示にする。

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS decision_why TEXT,
  ADD COLUMN IF NOT EXISTS decision_due TEXT;
