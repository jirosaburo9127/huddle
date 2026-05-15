"use client";

import { useMemo } from "react";
import type { BoardNoteWithProfile } from "@/lib/supabase/types";
import { StickyNote } from "./sticky-note";

type Props = {
  notes: BoardNoteWithProfile[];
};

export function BoardCanvas({ notes }: Props) {
  // カテゴリ別にグループ化（未分類は末尾）
  const grouped = useMemo(() => {
    const map = new Map<string, BoardNoteWithProfile[]>();
    const uncategorized: BoardNoteWithProfile[] = [];

    for (const note of notes) {
      if (!note.category) {
        uncategorized.push(note);
      } else {
        const list = map.get(note.category);
        if (list) {
          list.push(note);
        } else {
          map.set(note.category, [note]);
        }
      }
    }

    // カテゴリを投稿数の多い順にソート
    const sorted = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
    if (uncategorized.length > 0) {
      sorted.push(["未分類", uncategorized]);
    }
    return sorted;
  }, [notes]);

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted px-6">
        <div className="text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-sm">まだ付箋がありません</p>
          <p className="text-xs mt-1 text-muted/70">チャットでアイディアを投稿してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {grouped.map(([category, categoryNotes]) => (
          <div key={category} className="space-y-2">
            {/* カテゴリヘッダ */}
            <div className="flex items-center gap-2 px-1">
              <h3 className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
                {category}
              </h3>
              <span className="text-[10px] bg-foreground/10 text-foreground/50 rounded-full px-1.5 py-0.5">
                {categoryNotes.length}
              </span>
            </div>
            {/* 付箋リスト */}
            <div className="space-y-2">
              {categoryNotes.map((note) => (
                <StickyNote key={note.id} note={note} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
