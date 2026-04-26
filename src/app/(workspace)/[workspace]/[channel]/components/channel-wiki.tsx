"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  channelId: string;
  onClose: () => void;
};

// Markdownプレビュー用の簡易パーサー
function renderMarkdownPreview(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // コードブロック
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    return `<pre class="bg-white/[0.06] rounded-lg p-3 my-1 overflow-x-auto"><code class="text-sm font-mono">${code.trim()}</code></pre>`;
  });
  // インラインコード
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-white/[0.06] px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
  // 太字
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // URL
  html = html.replace(
    /(?<!["=])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">$1</a>'
  );
  // 改行
  html = html.replace(/\n/g, "<br />");

  return html;
}

export function ChannelWiki({ channelId, onClose }: Props) {
  const [content, setContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  // Wikiデータの取得
  useEffect(() => {
    async function fetchNote() {
      const { data } = await supabase
        .from("channel_notes")
        .select("content")
        .eq("channel_id", channelId)
        .single();
      if (data) {
        setContent(data.content || "");
      }
      setLoading(false);
    }
    fetchNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // 保存処理
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSaving(false);
      return;
    }

    // upsert: channel_idが既存ならupdate、なければinsert
    const { data: existing } = await supabase
      .from("channel_notes")
      .select("id")
      .eq("channel_id", channelId)
      .single();

    if (existing) {
      await supabase
        .from("channel_notes")
        .update({
          content: editContent,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("channel_id", channelId);
    } else {
      await supabase
        .from("channel_notes")
        .insert({
          channel_id: channelId,
          content: editContent,
          updated_by: user.id,
        });
    }

    setContent(editContent);
    setIsEditing(false);
    setIsSaving(false);
  }, [supabase, channelId, editContent]);

  return (
    <div className="fixed inset-0 z-40 bg-background lg:static lg:inset-auto lg:z-auto lg:w-96 lg:border-l lg:border-border flex flex-col h-full animate-slide-in-right">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <h2 className="font-bold text-xl flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Wiki
        </h2>
        <button
          onClick={onClose}
          className="p-1 text-muted hover:text-foreground rounded transition-colors"
          title="閉じる"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="text-muted text-sm">読み込み中...</div>
        ) : isEditing ? (
          <div className="space-y-3">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-64 resize-none rounded-lg border border-border bg-input-bg px-3 py-2 text-sm leading-relaxed text-foreground focus:border-accent focus:outline-none font-mono"
              placeholder="Markdownで記述できます（**太字**, `コード`, ```コードブロック```）"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {isSaving ? "保存中..." : "保存"}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            {content ? (
              <div
                className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words [&_pre]:whitespace-pre [&_pre]:my-2"
                dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(content) }}
              />
            ) : (
              <div className="text-muted text-sm text-center py-8">
                <p>まだWikiが作成されていません</p>
                <p className="text-xs mt-1">チャンネルの共有メモを作成しましょう</p>
              </div>
            )}
            <button
              onClick={() => { setEditContent(content); setIsEditing(true); }}
              className="mt-4 flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground hover:border-accent/30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              編集する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
