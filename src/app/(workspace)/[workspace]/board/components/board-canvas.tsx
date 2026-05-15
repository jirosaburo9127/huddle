"use client";

import { useMemo } from "react";
import type { BoardNoteWithProfile } from "@/lib/supabase/types";
import { StickyNote, categoryColor } from "./sticky-note";

type Props = {
  notes: BoardNoteWithProfile[];
};

// ノートIDから擬似ランダムな位置・回転を決定（同じIDなら同じ位置）
function notePosition(id: string, index: number, total: number) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash);
  // 画面を均等に埋めるため、indexベースのグリッド位置にランダムオフセットを加える
  const cols = Math.max(4, Math.ceil(Math.sqrt(total * 1.5)));
  const row = Math.floor(index / cols);
  const col = index % cols;
  const cellW = 100 / cols;
  const cellH = cellW * 1.2;
  const left = col * cellW + (h % 30) * cellW * 0.01;
  const top = row * cellH + ((h >> 8) % 30) * cellH * 0.01;
  const rotate = ((h % 13) - 6) * 1.2; // -7.2deg ~ +7.2deg
  return { left: `${Math.min(left, 95)}%`, top: `${top}%`, rotate: `${rotate}deg` };
}

export function BoardCanvas({ notes }: Props) {
  // カテゴリ一覧（凡例用）
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      if (n.category) set.add(n.category);
    }
    return [...set];
  }, [notes]);

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted px-6">
        <div className="text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-sm">まだ付箋がありません</p>
          <p className="text-xs mt-1 text-muted/70">下の入力欄からアイディアを投稿してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto relative">
      {/* カテゴリ凡例 */}
      {categories.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap gap-2 px-4 py-2 bg-background/80 backdrop-blur-sm">
          {categories.map((cat) => (
            <span
              key={cat}
              className={`text-[10px] px-2 py-0.5 text-gray-700 font-medium ${categoryColor(cat)}`}
            >
              {cat}
            </span>
          ))}
        </div>
      )}

      {/* 付箋が散らばるエリア */}
      <div className="relative" style={{ minHeight: Math.max(500, Math.ceil(notes.length / 4) * 160) }}>
        {notes.map((note, i) => {
          const pos = notePosition(note.id, i, notes.length);
          return (
            <div
              key={note.id}
              className="absolute transition-all duration-500 hover:z-10 hover:scale-110"
              style={{
                left: pos.left,
                top: pos.top,
                transform: `rotate(${pos.rotate})`,
              }}
            >
              <StickyNote note={note} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
