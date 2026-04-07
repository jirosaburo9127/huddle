"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BookmarkEntry = {
  id: string;
  message_id: string;
  created_at: string;
  message: {
    id: string;
    content: string;
    created_at: string;
    channel_id: string;
    profiles: {
      display_name: string;
    };
    channels: {
      name: string;
      slug: string;
      workspace_id: string;
    };
  };
};

type Props = {
  currentUserId: string;
  workspaceSlug: string;
  onClose: () => void;
};

export function BookmarkModal({ currentUserId, workspaceSlug, onClose }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  // ブックマーク一覧を取得
  useEffect(() => {
    async function fetchBookmarks() {
      const { data } = await supabase
        .from("bookmarks")
        .select(`
          id,
          message_id,
          created_at,
          messages(
            id,
            content,
            created_at,
            channel_id,
            profiles(display_name),
            channels(name, slug, workspace_id)
          )
        `)
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      if (data) {
        // Supabaseのリレーション結果を整形
        const entries = data
          .filter((b: Record<string, unknown>) => b.messages)
          .map((b: Record<string, unknown>) => {
            const msg = b.messages as Record<string, unknown>;
            return {
              id: b.id as string,
              message_id: b.message_id as string,
              created_at: b.created_at as string,
              message: {
                id: msg.id as string,
                content: msg.content as string,
                created_at: msg.created_at as string,
                channel_id: msg.channel_id as string,
                profiles: msg.profiles as { display_name: string },
                channels: msg.channels as { name: string; slug: string; workspace_id: string },
              },
            };
          });
        setBookmarks(entries);
      }
      setLoading(false);
    }
    fetchBookmarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // ブックマーク解除
  async function handleRemove(bookmarkId: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    await supabase.from("bookmarks").delete().eq("id", bookmarkId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] rounded-2xl bg-sidebar border border-border flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            ブックマーク
          </h2>
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ブックマーク一覧 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-muted text-sm text-center py-8">読み込み中...</div>
          ) : bookmarks.length === 0 ? (
            <div className="text-muted text-sm text-center py-8">
              <p>ブックマークはまだありません</p>
              <p className="text-xs mt-1">メッセージの「保存」ボタンでブックマークできます</p>
            </div>
          ) : (
            bookmarks.map((bookmark) => {
              const channelSlug = bookmark.message.channels?.slug || "";
              const channelName = bookmark.message.channels?.name || "不明";
              const senderName = bookmark.message.profiles?.display_name || "不明";
              const time = new Date(bookmark.message.created_at).toLocaleString("ja-JP", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              // メッセージ内容のプレビュー（100文字まで）
              const preview = bookmark.message.content.length > 100
                ? bookmark.message.content.slice(0, 100) + "..."
                : bookmark.message.content;

              return (
                <div
                  key={bookmark.id}
                  className="rounded-xl border border-border/50 p-3 hover:border-accent/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={`/${workspaceSlug}/${channelSlug}`}
                      className="flex-1 min-w-0"
                      onClick={onClose}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted mb-1">
                        <span className="text-accent font-medium">#{channelName}</span>
                        <span>{senderName}</span>
                        <span>{time}</span>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3">
                        {preview}
                      </p>
                    </a>
                    {/* ブックマーク解除 */}
                    <button
                      onClick={() => handleRemove(bookmark.id)}
                      className="shrink-0 p-1 text-muted hover:text-mention rounded transition-colors"
                      title="ブックマーク解除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
