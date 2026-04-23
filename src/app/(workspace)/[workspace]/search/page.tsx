"use client";

import { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  sender_name: string;
  sender_avatar: string | null;
};

export default function SearchPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function doSearch(q: string) {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: ws } = await supabase.from("workspaces").select("id").eq("slug", params.workspace).maybeSingle();
    if (!ws) { setLoading(false); return; }
    const { data } = await supabase.rpc("search_messages", {
      p_user_id: user.id,
      p_workspace_id: ws.id,
      p_query: q.trim(),
    });
    if (data && Array.isArray(data)) {
      setResults(data as SearchResult[]);
    } else {
      setResults([]);
    }
    setLoading(false);
  }

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 500);
  }

  // コンテンツのハイライト表示
  function highlightContent(content: string, q: string) {
    if (!q.trim()) return content;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = content.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? `<mark class="bg-accent/30 text-foreground rounded px-0.5">${part}</mark>`
        : part
    ).join("");
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="投稿を検索..."
            className="w-full bg-input-bg border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-foreground focus:border-accent outline-none placeholder:text-muted/50"
          />
        </div>
      </header>

      {/* 結果 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-16 text-muted">検索中...</div>
        ) : !searched ? (
          <div className="text-center py-16 text-muted">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">キーワードを入力して投稿を検索</p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-16 text-muted">
            <p className="text-sm">「{query}」に一致する投稿はありません</p>
          </div>
        ) : (
          <div>
            <p className="px-4 py-2 text-xs text-muted">{results.length}件の結果</p>
            {results.map((r) => (
              <Link
                key={r.id}
                href={`/${params.workspace}/${r.channel_slug}`}
                className="block px-4 py-3 border-b border-border/30 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  {r.sender_avatar ? (
                    <img src={r.sender_avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-accent">{r.sender_name[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">{r.sender_name}</span>
                  <span className="text-xs text-muted">
                    {new Date(r.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric", timeZone: "Asia/Tokyo" })}
                  </span>
                  <span className="text-xs text-accent ml-auto shrink-0">#{r.channel_name.length > 10 ? r.channel_name.slice(0, 10) + "…" : r.channel_name}</span>
                </div>
                <div
                  className="text-sm text-foreground/80 line-clamp-2 break-words"
                  dangerouslySetInnerHTML={{ __html: highlightContent(r.content.replace(/\n/g, " ").slice(0, 150), query) }}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
