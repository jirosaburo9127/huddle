"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AlbumSummary } from "@/lib/supabase/types";
import { AlbumDetailModal } from "@/app/(workspace)/[workspace]/albums/components/album-detail-modal";
import { CreateAlbumModal } from "@/app/(workspace)/[workspace]/albums/components/create-album-modal";

type Props = {
  channelId: string;
  channelName: string;
  workspaceId: string;
  currentUserId: string;
  onClose: () => void;
};

export function ChannelAlbums({ channelId, channelName, workspaceId, currentUserId, onClose }: Props) {
  const supabase = createClient();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [addToAlbumId, setAddToAlbumId] = useState<string | null>(null);

  const fetchAlbums = useCallback(async () => {
    const { data } = await supabase
      .from("albums")
      .select("*, profiles!albums_created_by_fkey(display_name)")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false });

    if (data) {
      const summaries: AlbumSummary[] = [];
      for (const a of data) {
        const { count } = await supabase
          .from("album_items")
          .select("id", { count: "exact", head: true })
          .eq("album_id", a.id);
        const { data: firstItem } = await supabase
          .from("album_items")
          .select("url")
          .eq("album_id", a.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const profile = a.profiles as { display_name: string } | null;
        summaries.push({
          ...a,
          channel_name: channelName,
          channel_slug: "",
          creator_name: profile?.display_name || "",
          item_count: count || 0,
          first_item_url: firstItem?.url || null,
        });
      }
      setAlbums(summaries);
    }
    setLoading(false);
  }, [channelId, channelName, supabase]);

  useEffect(() => {
    fetchAlbums();
  }, [fetchAlbums]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <h2 className="text-base font-bold text-foreground">📸 #{channelName} のアルバム</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              作成
            </button>
            <button onClick={onClose} className="p-1 text-muted hover:text-foreground transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : albums.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">
              <p>まだアルバムがありません</p>
              <button onClick={() => setShowCreate(true)} className="text-accent text-xs mt-2 hover:underline">
                アルバムを作成
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {albums.map((album) => {
                const coverUrl = album.first_item_url || album.cover_url;
                return (
                  <button
                    key={album.id}
                    onClick={() => setSelectedAlbum(album)}
                    className="text-left rounded-xl overflow-hidden group"
                  >
                    <div className="aspect-square bg-border/20 relative overflow-hidden">
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">📷</div>
                      )}
                      <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {album.item_count}
                      </span>
                    </div>
                    <div className="px-1 py-1.5">
                      <p className="text-xs font-medium text-foreground truncate">{album.title}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          currentUserId={currentUserId}
          onClose={() => setSelectedAlbum(null)}
          onAddItems={() => {
            setAddToAlbumId(selectedAlbum.id);
            setSelectedAlbum(null);
          }}
        />
      )}

      {showCreate && (
        <CreateAlbumModal
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          channels={[{ id: channelId, name: channelName, slug: "" }]}
          onClose={() => setShowCreate(false)}
          onCreated={fetchAlbums}
        />
      )}

      {addToAlbumId && (
        <CreateAlbumModal
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          channels={[{ id: channelId, name: channelName, slug: "" }]}
          addToAlbumId={addToAlbumId}
          onClose={() => setAddToAlbumId(null)}
          onCreated={fetchAlbums}
        />
      )}
    </div>
  );
}
