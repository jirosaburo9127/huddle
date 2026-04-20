"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

type FileItem = {
  id: string;
  content: string;
  created_at: string;
  channel_name: string;
  channel_slug: string;
  sender_name: string;
  sender_avatar: string | null;
  fileName: string;
  fileType: "pdf" | "image" | "video" | "other";
};

const STORAGE_URL_RE = /https:\/\/[^\s]+supabase[^\s]+\/storage\/v1\/object\/public\/chat-files\/[^\s\n]+/g;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?.*)?$/i;
const PDF_EXT = /\.pdf(\?.*)?$/i;

function extractFileName(url: string): string {
  try {
    const segments = new URL(url).pathname.split("/");
    const last = segments[segments.length - 1];
    const match = last.match(/^[0-9a-f-]+-(.+)$/);
    return match ? decodeURIComponent(match[1]) : decodeURIComponent(last);
  } catch {
    return "ファイル";
  }
}

function getFileType(url: string): FileItem["fileType"] {
  // URL全体とファイル名の両方で拡張子を探す
  const targets = [url.toLowerCase()];
  try { targets.push(new URL(url).pathname.toLowerCase()); } catch {}
  targets.push(extractFileName(url).toLowerCase());

  for (const s of targets) {
    if (/\.pdf/.test(s)) return "pdf";
    if (/\.(jpg|jpeg|png|gif|webp)/.test(s)) return "image";
    if (/\.(mp4|mov|webm|m4v)/.test(s)) return "video";
  }
  return "other";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  all: "すべて",
  pdf: "PDF",
  image: "画像",
  video: "動画",
  other: "その他",
};

export default function FilesPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | FileItem["fileType"]>("all");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", params.workspace)
        .maybeSingle();
      if (!ws) { setLoading(false); return; }

      // Storage URLを含むメッセージを取得
      const { data } = await supabase
        .from("messages")
        .select(
          "id, content, created_at, channels!inner(name, slug, workspace_id, is_dm), profiles!inner(display_name, avatar_url)"
        )
        .is("deleted_at", null)
        .eq("channels.workspace_id", ws.id)
        .like("content", "%supabase%storage%chat-files%")
        .order("created_at", { ascending: false })
        .limit(500);

      if (data) {
        const files: FileItem[] = [];
        for (const row of data as Array<{
          id: string; content: string; created_at: string;
          channels: unknown; profiles: unknown;
        }>) {
          const ch = Array.isArray(row.channels) ? row.channels[0] : (row.channels as { name: string; slug: string });
          const p = Array.isArray(row.profiles) ? row.profiles[0] : (row.profiles as { display_name: string; avatar_url: string | null });
          // メッセージ内の全Storage URLを抽出
          const urls = row.content.match(STORAGE_URL_RE) || [];
          for (const url of urls) {
            files.push({
              id: `${row.id}-${url.slice(-8)}`,
              content: url,
              created_at: row.created_at,
              channel_name: ch?.name || "",
              channel_slug: ch?.slug || "",
              sender_name: p?.display_name || "メンバー",
              sender_avatar: p?.avatar_url || null,
              fileName: extractFileName(url),
              fileType: getFileType(url),
            });
          }
        }
        setItems(files);
      }
      setLoading(false);
    })();
  }, [params.workspace]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((f) => f.fileType === filter);
  }, [items, filter]);

  // ファイルタイプ別カウント
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const f of items) c[f.fileType] = (c[f.fileType] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <svg className="w-5 h-5 text-muted mr-2" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <h1 className="font-bold text-lg">ファイル</h1>
      </header>

      {/* フィルタータブ */}
      <div className="flex gap-1 px-4 py-2 border-b border-border/50 overflow-x-auto">
        {(["all", "pdf", "image", "video", "other"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              filter === type
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground bg-white/[0.03] border border-border/50"
            }`}
          >
            {FILE_TYPE_LABELS[type]} {counts[type] ? `(${counts[type]})` : ""}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-2">
          {loading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p>ファイルがありません</p>
            </div>
          ) : (
            filtered.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-border/50 hover:bg-white/[0.04] transition-colors"
              >
                {/* ファイルアイコン */}
                <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                  file.fileType === "pdf" ? "bg-red-400/15 text-red-400" :
                  file.fileType === "image" ? "bg-blue-400/15 text-blue-400" :
                  file.fileType === "video" ? "bg-purple-400/15 text-purple-400" :
                  "bg-muted/15 text-muted"
                }`}>
                  {file.fileType === "pdf" && (
                    <span className="text-xs font-bold">PDF</span>
                  )}
                  {file.fileType === "image" && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  )}
                  {file.fileType === "video" && (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                  {file.fileType === "other" && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  )}
                </div>

                {/* ファイル情報 */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{file.fileName}</div>
                  <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                    <span>{file.sender_name}</span>
                    <span>#{file.channel_name}</span>
                    <span>{formatDate(file.created_at)}</span>
                  </div>
                </div>

                {/* アクション */}
                <div className="flex items-center gap-1 shrink-0">
                  <Link
                    href={`/${params.workspace}/${file.channel_slug}`}
                    className="p-2 text-muted hover:text-accent rounded-lg hover:bg-accent/10 transition-colors"
                    title="チャンネルを開く"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </Link>
                  <a
                    href={file.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-muted hover:text-accent rounded-lg hover:bg-accent/10 transition-colors"
                    title="ダウンロード"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
