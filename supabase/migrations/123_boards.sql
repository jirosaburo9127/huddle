-- 付箋ボード機能
-- ワークスペースごとに複数ボードを作成し、参加者がアイディアを付箋形式で投稿。
-- カテゴリはEdge Function（Claude API）で自動分類される。

-- ボードテーブル
CREATE TABLE IF NOT EXISTS public.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '付箋ボード',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_boards_workspace ON public.boards(workspace_id);
CREATE INDEX idx_boards_active ON public.boards(workspace_id, is_active) WHERE is_active = TRUE;

-- 付箋ノートテーブル
CREATE TABLE IF NOT EXISTS public.board_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  category TEXT,
  color TEXT NOT NULL DEFAULT 'yellow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_board_notes_board ON public.board_notes(board_id);
CREATE INDEX idx_board_notes_category ON public.board_notes(board_id, category);

-- RLS
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_notes ENABLE ROW LEVEL SECURITY;

-- boards: ワークスペースメンバーなら閲覧可
CREATE POLICY "boards_select" ON public.boards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = boards.workspace_id AND user_id = auth.uid()
    )
  );

-- boards: ワークスペースメンバーなら作成可
CREATE POLICY "boards_insert" ON public.boards
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = boards.workspace_id AND user_id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- boards: 作成者なら更新可（終了操作）
CREATE POLICY "boards_update" ON public.boards
  FOR UPDATE USING (created_by = auth.uid());

-- board_notes: ボードが属するWSメンバーなら閲覧可
CREATE POLICY "board_notes_select" ON public.board_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      JOIN public.workspace_members wm ON wm.workspace_id = b.workspace_id
      WHERE b.id = board_notes.board_id AND wm.user_id = auth.uid()
    )
  );

-- board_notes: ボードが属するWSメンバーなら作成可
CREATE POLICY "board_notes_insert" ON public.board_notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards b
      JOIN public.workspace_members wm ON wm.workspace_id = b.workspace_id
      WHERE b.id = board_notes.board_id AND wm.user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

-- board_notes: カテゴリ更新はservice_roleのみ（Edge Functionから）
-- フロントエンドからはRLSでブロック
CREATE POLICY "board_notes_update_service" ON public.board_notes
  FOR UPDATE USING (false);

-- Realtime有効化
ALTER PUBLICATION supabase_realtime ADD TABLE public.board_notes;

-- 付箋分類用のEdge Functionトリガー
CREATE OR REPLACE FUNCTION public.notify_classify_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM net.http_post(
    url := COALESCE(
      current_setting('supabase.functions_url', true),
      'https://emfngqketrieioxusuhg.supabase.co/functions/v1'
    ) || '/classify-board-note',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('supabase.service_role_key', true),
        ''
      )
    ),
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'id', NEW.id,
        'board_id', NEW.board_id,
        'content', NEW.content
      )
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_notes_classify_trigger
  AFTER INSERT ON public.board_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_classify_note();

-- RLS権限付与
GRANT SELECT, INSERT ON public.boards TO authenticated;
GRANT UPDATE (is_active, closed_at) ON public.boards TO authenticated;
GRANT SELECT, INSERT ON public.board_notes TO authenticated;
