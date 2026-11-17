"use client";

import { stripSystemEmoji } from "@/lib/system-post-icons";
import { useState, useRef, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

// 1回の取得件数（RPC 側の上限は100）
const PAGE_SIZE = 50;

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
  useEffect(() => { setSidebarOpen(false); }, [setSidebarOpen]);
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // 続きがあるか / 続きを読み込み中か
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 入力が速いと古い検索の応答が後から返ってくるため、最新の検索だけ反映する
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSearchDone = useRef(false);

  // URLパラメータからの初期検索
  useEffect(() => {
    if (initialQuery && !initialSearchDone.current) {
      initialSearchDone.current = true;
      doSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // 検索RPCを1ページ分呼ぶ。失敗時は null
  async function fetchPage(q: string, offset: number): Promise<SearchResult[] | null> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: ws } = await supabase.from("workspaces").select("id").eq("slug", params.workspace).maybeSingle();
    if (!ws) return null;
    const { data, error } = await supabase.rpc("search_messages", {
      p_user_id: user.id,
      p_workspace_id: ws.id,
      p_query: q,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) {
      console.error("search_messages failed", error);
      return null;
    }
    return Array.isArray(data) ? (data as SearchResult[]) : [];
  }

  async function doSearch(q: string) {
    const reqId = ++requestIdRef.current;
    if (!q.trim()) { setResults([]); setSearched(false); setHasMore(false); setLoading(false); return; }
    setLoading(true);
    setSearched(true);
    const page = await fetchPage(q.trim(), 0);
    if (reqId !== requestIdRef.current) return;
    setResults(page ?? []);
    setHasMore((page?.length ?? 0) === PAGE_SIZE);
    setLoading(false);
  }

  // 「さらに表示」: 今の件数を offset にして続き（より古い投稿）を取得
  async function loadMore() {
    if (loadingMore || !query.trim()) return;
    const reqId = requestIdRef.current;
    setLoadingMore(true);
    const page = await fetchPage(query.trim(), results.length);
    if (reqId !== requestIdRef.current) { setLoadingMore(false); return; }
    if (page) {
      setResults((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        return [...prev, ...page.filter((r) => !ids.has(r.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(value);
      // URLにクエリを保持（ブラウザバックで復元可能）
      const url = new URL(window.location.href);
      if (value.trim()) {
        url.searchParams.set("q", value.trim());
      } else {
        url.searchParams.delete("q");
      }
      window.history.replaceState({}, "", url.toString());
    }, 500);
  }

  // コンテンツのハイライト表示。
  // 旧実装では文字列連結 + dangerouslySetInnerHTML を使っていたため、
  // 本文に <script> 等の HTML 断片が含まれていると XSS になりえた。
  // React 要素として返すことで、各 part は React が自動でエスケープし、
  // <mark> だけが意図したタグとして残る安全な実装にする。
  function renderHighlighted(content: string, q: string): React.ReactNode {
    if (!q.trim()) return content;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = content.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-accent/30 text-foreground rounded px-0.5">{part}</mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
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
            <p className="px-4 py-2 text-xs text-muted">{results.length}{hasMore ? "件以上" : "件"}の結果</p>
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  // 検索結果を残したまま遷移（ブラウザバックで検索結果に戻れる）
                  router.push(`/${params.workspace}/${r.channel_slug}?m=${r.id}&from=search`);
                }}
                className="block w-full text-left px-4 py-3 border-b border-border/30 hover:bg-sidebar-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  {r.sender_avatar ? (
                    <img src={r.sender_avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/20 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-accent">{r.sender_name[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">{r.sender_name}</span>
                  <span className="text-xs text-muted">
                    {new Date(r.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric", timeZone: "Asia/Tokyo" })}
                  </span>
                  <span className="text-xs text-accent ml-auto shrink-0">#{r.channel_name.length > 10 ? r.channel_name.slice(0, 10) + "…" : r.channel_name}</span>
                </div>
                <div className="text-sm text-foreground/80 line-clamp-2 break-words">
                  {renderHighlighted(stripSystemEmoji(r.content).replace(/\n/g, " ").slice(0, 150), query)}
                </div>
              </button>
            ))}
            {hasMore && (
              <div className="px-4 py-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => { void loadMore(); }}
                  disabled={loadingMore}
                  className="px-5 py-2 rounded-full border border-border text-sm text-foreground hover:bg-sidebar-hover disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "読み込み中..." : "さらに表示（もっと前の投稿）"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
