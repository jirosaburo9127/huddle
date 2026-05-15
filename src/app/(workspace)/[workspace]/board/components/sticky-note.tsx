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

function categoryColor(category: string | null): string {
  if (!category) return "bg-stone-200";
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash + category.charCodeAt(i)) | 0;
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return new Date(dateStr).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

type Props = {
  note: BoardNoteWithProfile;
};

export function StickyNote({ note }: Props) {
  const colorClass = categoryColor(note.category);
  const displayName = note.profiles?.display_name || "メンバー";
  const avatarUrl = note.profiles?.avatar_url;

  return (
    <div
      className={`aspect-square w-full p-3 shadow-md transition-all duration-300 flex flex-col ${colorClass}`}
      style={{ minHeight: 120 }}
    >
      {/* 内容 */}
      <p className="text-base text-gray-800 whitespace-pre-wrap break-words leading-relaxed flex-1 font-medium">
        {note.content}
      </p>

      {/* 投稿者 + 時刻 */}
      <div className="flex items-center gap-1.5 mt-auto pt-2">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
        ) : (
          <div className="w-4 h-4 rounded-full bg-black/10 flex items-center justify-center">
            <span className="text-[8px] font-bold text-black/40">
              {displayName[0]?.toUpperCase()}
            </span>
          </div>
        )}
        <span className="text-[11px] text-black/40 truncate">{displayName}</span>
        <span className="text-[10px] text-black/25 ml-auto shrink-0">{relativeTime(note.created_at)}</span>
      </div>

      {/* 分類中インジケーター */}
      {!note.category && (
        <div className="flex items-center gap-1 mt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
          <span className="text-[9px] text-black/25">分類中...</span>
        </div>
      )}
    </div>
  );
}
