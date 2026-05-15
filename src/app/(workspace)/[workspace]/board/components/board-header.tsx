"use client";

import type { Board } from "@/lib/supabase/types";

type Props = {
  board: Board | null;
  noteCount: number;
  onCreateBoard: () => void;
  onCloseBoard: () => void;
};

export function BoardHeader({ board, noteCount, onCreateBoard, onCloseBoard }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-header shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg">📋</span>
        <h1 className="text-base font-bold text-foreground truncate">
          {board ? board.title : "付箋ボード"}
        </h1>
        {board && (
          <span className="text-xs bg-accent/10 text-accent rounded-full px-2 py-0.5 shrink-0">
            {noteCount}件
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {board ? (
          <button
            onClick={onCloseBoard}
            className="text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.04]"
          >
            終了
          </button>
        ) : (
          <button
            onClick={onCreateBoard}
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
          >
            新規ボード
          </button>
        )}
      </div>
    </header>
  );
}
