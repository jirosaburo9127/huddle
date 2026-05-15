"use client";

import type { BoardNoteWithProfile } from "@/lib/supabase/types";

// カテゴリ名から背景色を決定（同じカテゴリは同じ色）
const CATEGORY_COLORS = [
  "bg-amber-200",
  "bg-sky-200",
  "bg-lime-200",
  "bg-pink-200",
  "bg-violet-200",
  "bg-orange-200",
  "bg-teal-200",
  "bg-rose-200",
];

export function categoryColor(category: string | null): string {
  if (!category) return "bg-stone-200";
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash + category.charCodeAt(i)) | 0;
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

type Props = {
  note: BoardNoteWithProfile;
};

export function StickyNote({ note }: Props) {
  const colorClass = categoryColor(note.category);
  const displayName = note.profiles?.display_name || "";

  return (
    <div className={`w-28 h-28 p-2 shadow-md flex flex-col ${colorClass}`}>
      {/* 内容 */}
      <p className="text-xs text-gray-800 leading-tight flex-1 overflow-hidden line-clamp-5">
        {note.content}
      </p>
      {/* 投稿者 */}
      <div className="mt-auto pt-1">
        <span className="text-[9px] text-black/35 truncate block">{displayName}</span>
      </div>
    </div>
  );
}
