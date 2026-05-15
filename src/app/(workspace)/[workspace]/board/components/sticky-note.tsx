"use client";

import type { BoardNoteWithProfile } from "@/lib/supabase/types";

// カテゴリ名から背景色を決定（同じカテゴリは同じ色）
const CATEGORY_COLORS = [
  "bg-amber-100 border-amber-300",
  "bg-blue-100 border-blue-300",
  "bg-green-100 border-green-300",
  "bg-pink-100 border-pink-300",
  "bg-purple-100 border-purple-300",
  "bg-orange-100 border-orange-300",
  "bg-teal-100 border-teal-300",
  "bg-rose-100 border-rose-300",
];

function categoryColor(category: string | null): string {
  if (!category) return "bg-gray-100 border-gray-300";
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
      className={`rounded-xl border-2 p-3 shadow-sm transition-all duration-300 ${colorClass}`}
    >
      {/* カテゴリラベル */}
      {note.category && (
        <div className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-1">
          {note.category}
        </div>
      )}
      {!note.category && (
        <div className="text-[10px] text-black/30 mb-1 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
          分類中...
        </div>
      )}

      {/* 内容 */}
      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
        {note.content}
      </p>

      {/* 投稿者 + 時刻 */}
      <div className="flex items-center gap-1.5 mt-2">
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
        <span className="text-[11px] text-black/50 truncate">{displayName}</span>
        <span className="text-[10px] text-black/30 ml-auto shrink-0">{relativeTime(note.created_at)}</span>
      </div>
    </div>
  );
}
