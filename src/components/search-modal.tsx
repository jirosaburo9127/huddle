"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  onClose: () => void;
};

// 検索結果の型定義
type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  channels: {
    name: string;
    slug: string;
  };
  profiles: {
    display_name: string;
  };
};

export function SearchModal({ workspaceId, workspaceSlug, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  // 入力フォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 検索実行（デバウンス付き）
  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);

      // まず textSearch（tsvector）で試行
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, content, created_at, channel_id, channels(name, slug), profiles(display_name)"
        )
        .is("deleted_at", null)
        .textSearch("content_tsv", q, { type: "plain" })
        .limit(20);

      if (error || !data || data.length === 0) {
        // フォールバック: ilike で部分一致検索
        const { data: fallbackData } = await supabase
          .from("messages")
          .select(
            "id, content, created_at, channel_id, channels(name, slug), profiles(display_name)"
          )
          .is("deleted_at", null)
          .ilike("content", `%${q}%`)
          .limit(20);

        // ワークスペース内のチャンネルだけにフィルタリング
        const filtered = ((fallbackData || []) as unknown as SearchResult[]).filter(
          (r: SearchResult) => r.channels !== null
        );
        setResults(filtered);
      } else {
        // ワークスペース内のチャンネルだけにフィルタリング
        const filtered = ((data || []) as unknown as SearchResult[]).filter(
          (r: SearchResult) => r.channels !== null
        );
        setResults(filtered);
      }

      setLoading(false);
    },
    [supabase]
  );

  // デバウンス: 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  // 外側クリックで閉じる
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }

  // 結果クリック時の遷移
  function handleResultClick(result: SearchResult) {
    router.push(`/${workspaceSlug}/${result.channels.slug}`);
    onClose();
  }

  // 日付フォーマット
  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // コンテンツのプレビュー（長すぎる場合は切り詰め）
  function truncateContent(content: string, maxLen = 120): string {
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen) + "...";
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl bg-sidebar border border-border shadow-2xl overflow-hidden animate-fade-in">
        {/* 検索入力 */}
        <div className="flex items-center border-b border-border">
          {/* 検索アイコン */}
          <svg
            className="ml-4 h-5 w-5 text-muted shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="メッセージを検索..."
            className="w-full bg-transparent px-4 py-3 text-base text-foreground placeholder-muted focus:outline-none"
          />
          {/* Escキーヒント */}
          <span className="mr-4 text-xs text-muted/60 border border-border/50 rounded px-1.5 py-0.5 shrink-0">
            Esc
          </span>
        </div>

        {/* 検索結果 */}
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-sm text-muted">
              検索中...
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">
              該当するメッセージが見つかりませんでした
            </div>
          )}

          {!loading && !query.trim() && (
            <div className="px-4 py-6 text-center text-sm text-muted">
              キーワードを入力してメッセージを検索
            </div>
          )}

          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => handleResultClick(result)}
              className="w-full text-left px-4 py-3 hover:bg-white/[0.04] cursor-pointer border-b border-border/30 transition-colors"
            >
              {/* ヘッダー: チャンネル名 / ユーザー名 / 日付 */}
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <span className="text-accent font-medium">
                  #{result.channels.name}
                </span>
                <span className="text-muted/40">·</span>
                <span>{result.profiles.display_name}</span>
                <span className="text-muted/40">·</span>
                <span>{formatDate(result.created_at)}</span>
              </div>
              {/* メッセージ内容 */}
              <p className="text-sm text-foreground/80 leading-relaxed">
                {truncateContent(result.content)}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
