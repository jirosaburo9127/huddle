"use client";

import type { AlbumSummary } from "@/lib/supabase/types";

type Props = {
  album: AlbumSummary;
  onClick: () => void;
};

export function AlbumCard({ album, onClick }: Props) {
  const coverUrl = album.first_item_url || album.cover_url;

  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl overflow-hidden transition-all hover:shadow-lg group"
    >
      {/* カバー画像 */}
      <div className="aspect-[4/3] bg-border/20 relative overflow-hidden">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={album.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl">📷</span>
          </div>
        )}
        {/* 枚数バッジ */}
        <span className="absolute bottom-2 right-2 bg-black/60 text-white text-[11px] font-medium px-2 py-0.5 rounded-full">
          {album.item_count}枚
        </span>
      </div>
      {/* 情報 */}
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-bold text-foreground truncate">{album.title}</h3>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[11px] text-accent">#{album.channel_name}</span>
          <span className="text-[10px] text-muted">·</span>
          <span className="text-[11px] text-muted">{album.creator_name}</span>
        </div>
        <span className="text-[10px] text-muted/60 mt-0.5 block">
          {new Date(album.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>
    </button>
  );
}
