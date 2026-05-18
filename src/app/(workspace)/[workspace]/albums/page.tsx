"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import type { AlbumSummary } from "@/lib/supabase/types";
import { AlbumCard } from "./components/album-card";
import { AlbumDetailModal } from "./components/album-detail-modal";
import { CreateAlbumModal } from "./components/create-album-modal";

export default function AlbumsPage() {
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;
  const supabase = createClient();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [channels, setChannels] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [addToAlbumId, setAddToAlbumId] = useState<string | null>(null);

  useEffect(() => {
    setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAlbums = useCallback(async () => {
    if (!workspaceId || !currentUserId) return;
    const { data } = await supabase.rpc("get_my_albums", {
      p_workspace_id: workspaceId,
      p_user_id: currentUserId,
    });
    if (data && Array.isArray(data)) {
      setAlbums(data as AlbumSummary[]);
    }
  }, [workspaceId, currentUserId, supabase]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      // workspace 切り替え時に前 workspace の内容が残らないようリセット
      setLoading(true);
      setAlbums([]);
      setChannels([]);
      setSelectedAlbum(null);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setCurrentUserId(user.id);

        const { data: ws } = await supabase
          .from("workspaces")
          .select("id")
          .eq("slug", workspaceSlug)
          .maybeSingle();
        if (!ws || cancelled) return;
        setWorkspaceId(ws.id);

        // 自分が参加しているチャンネル一覧（アルバム作成用）
        // この workspace のチャンネルだけに絞る
        const { data: chData } = await supabase
          .from("channel_members")
          .select("channels(id, name, slug, workspace_id)")
          .eq("user_id", user.id);
        if (chData && !cancelled) {
          const chs = chData
            .map((r: Record<string, unknown>) => {
              const ch = r.channels as unknown as
                | { id: string; name: string; slug: string; workspace_id: string }
                | null;
              return ch;
            })
            .filter(
              (ch: { id: string; name: string; slug: string; workspace_id: string } | null): ch is { id: string; name: string; slug: string; workspace_id: string } =>
                !!ch && ch.workspace_id === ws.id
            )
            .map((ch: { id: string; name: string; slug: string }) => ({ id: ch.id, name: ch.name, slug: ch.slug }));
          setChannels(chs);
        }

        // アルバム一覧
        const { data: albumData } = await supabase.rpc("get_my_albums", {
          p_workspace_id: ws.id,
          p_user_id: user.id,
        });
        if (!cancelled) {
          setAlbums(
            albumData && Array.isArray(albumData) ? (albumData as AlbumSummary[]) : []
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">📸</span>
          <h1 className="text-base font-bold text-foreground">アルバム</h1>
          {albums.length > 0 && (
            <span className="text-xs bg-accent/10 text-accent rounded-full px-2 py-0.5">
              {albums.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
        >
          新規作成
        </button>
      </header>

      {/* アルバム一覧 */}
      <div className="flex-1 overflow-y-auto p-4">
        {albums.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <div className="text-center">
              <div className="text-5xl mb-4">📸</div>
              <p className="text-base font-medium text-foreground mb-2">アルバム</p>
              <p className="text-sm text-muted mb-4">
                イベントや行事の写真をアルバムにまとめましょう
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="bg-accent text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                アルバムを作成
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {albums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onClick={() => setSelectedAlbum(album)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 詳細モーダル */}
      {selectedAlbum && currentUserId && (
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

      {/* 作成モーダル */}
      {showCreate && currentUserId && workspaceId && (
        <CreateAlbumModal
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          channels={channels}
          onClose={() => setShowCreate(false)}
          onCreated={fetchAlbums}
        />
      )}

      {/* 既存アルバムに追加 */}
      {addToAlbumId && currentUserId && workspaceId && (
        <CreateAlbumModal
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          channels={channels}
          addToAlbumId={addToAlbumId}
          onClose={() => setAddToAlbumId(null)}
          onCreated={fetchAlbums}
        />
      )}
    </div>
  );
}
