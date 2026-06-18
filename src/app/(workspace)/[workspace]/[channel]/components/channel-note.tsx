"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageLightbox } from "@/components/image-lightbox";

type Props = {
  channelId: string;
  onClose: (hasContent?: boolean) => void;
};

// 固定メモ用の最小Markdownプレビュー。
function renderMarkdownPreview(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // コードブロック
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    return `<pre class="bg-white/[0.06] rounded-lg p-3 my-1 overflow-x-auto"><code class="text-sm font-mono">${code.trim()}</code></pre>`;
  });
  // インラインコード
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-white/[0.06] px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
  // 太字
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 画像URL（chat-files内の画像）
  html = html.replace(
    /(?<!["=])(https?:\/\/[^\s<]*\/storage\/v1\/object\/public\/chat-files\/[^\s<]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<]*)?)/gi,
    '<img src="$1" alt="" class="rounded-lg max-w-full my-2" style="max-height:300px;object-fit:contain;" />'
  );
  // URL
  html = html.replace(
    /(?<!["=])(https?:\/\/[^\s<]+)/g,
    (_match, raw: string) => {
      const trimmed = raw.replace(/[。、．，）\])\}>"'`,.!?;:]+$/u, "");
      const dropped = raw.slice(trimmed.length);
      return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline break-all">${trimmed}</a>${dropped}`;
    }
  );
  // 改行
  html = html.replace(/\n/g, "<br />");

  return html;
}

export function ChannelNote({ channelId, onClose }: Props) {
  const [content, setContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightboxState, setLightboxState] = useState<{ urls: string[]; index: number } | null>(null);
  const supabase = createClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 画像ペースト処理
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        setUploading(true);
        const ext = file.type.split("/")[1] || "png";
        const path = `note-images/${channelId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("chat-files")
          .upload(path, file, { contentType: file.type });
        setUploading(false);
        if (uploadErr) {
          alert("画像のアップロードに失敗しました: " + uploadErr.message);
          return;
        }
        const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(path);
        setEditContent((prev) => prev + (prev ? "\n" : "") + urlData.publicUrl);
        return;
      }
    }
  }, [channelId, supabase]);

  // 固定メモの取得
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

    const nextContent = editContent.trim();

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
          content: nextContent,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("channel_id", channelId);
    } else {
      await supabase
        .from("channel_notes")
        .insert({
          channel_id: channelId,
          content: nextContent,
          updated_by: user.id,
        });
    }

    setContent(nextContent);
    setEditContent(nextContent);
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
          固定メモ
        </h2>
        <button
          onClick={() => onClose(!!content.trim())}
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
            {/* テキスト入力（画像URLは非表示、テキスト部分のみ編集） */}
            <textarea
              ref={textareaRef}
              value={editContent.split("\n").filter((l) => !/^https?:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim())).join("\n")}
              onChange={(e) => {
                // 画像URLを保持しつつテキスト部分だけ更新
                const imageLines = editContent.split("\n").filter((l) => /^https?:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim()));
                const newText = e.target.value;
                setEditContent(imageLines.length > 0 ? newText + "\n" + imageLines.join("\n") : newText);
              }}
              onPaste={handlePaste}
              className="w-full min-h-[120px] resize-y rounded-lg border border-border bg-input-bg px-3 py-2 text-sm leading-relaxed text-foreground focus:border-accent focus:outline-none"
              placeholder="このチャンネルの目的、よく使うリンク、約束ごとなど（画像のペーストも可）"
            />
            {/* 画像サムネイルプレビュー */}
            {editContent.split("\n").filter((l) => /^https?:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim())).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editContent.split("\n").filter((l) => /^https?:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim())).map((url, i) => (
                  <div key={i} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url.trim()} alt="" className="h-20 w-20 object-cover rounded-lg border border-border" />
                    <button
                      type="button"
                      onClick={() => {
                        setEditContent((prev) => prev.split("\n").filter((l) => l.trim() !== url.trim()).join("\n"));
                      }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-mention text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {isSaving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.style.position = "fixed";
                  input.style.opacity = "0.01";
                  input.style.width = "1px";
                  input.style.height = "1px";
                  document.body.appendChild(input);
                  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
                  input.addEventListener("change", async () => {
                    const file = input.files?.[0];
                    cleanup();
                    if (!file) return;
                    setUploading(true);
                    const ext = file.name.split(".").pop() || "png";
                    const path = `note-images/${channelId}/${crypto.randomUUID()}.${ext}`;
                    const { error: uploadErr } = await supabase.storage
                      .from("chat-files")
                      .upload(path, file, { contentType: file.type });
                    setUploading(false);
                    if (uploadErr) {
                      alert("画像のアップロードに失敗しました: " + uploadErr.message);
                      return;
                    }
                    const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(path);
                    setEditContent((prev) => prev + (prev ? "\n" : "") + urlData.publicUrl);
                  });
                  input.addEventListener("cancel", cleanup);
                  input.click();
                }}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-accent border border-border hover:border-accent/30 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {uploading ? "アップロード中..." : "画像"}
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
              <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words [&_pre]:whitespace-pre [&_pre]:my-2">
                {(() => {
                  const imageRegex = /^https?:\/\/[^\s]*\/storage\/v1\/object\/public\/chat-files\/[^\s]*\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i;
                  const lines = content.split("\n");
                  const imageUrls = lines.filter((l) => imageRegex.test(l.trim())).map((l) => l.trim());
                  const textParts = lines.filter((l) => !imageRegex.test(l.trim())).join("\n");
                  return (
                    <>
                      {textParts && (
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(textParts) }} />
                      )}
                      {imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {imageUrls.map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={i}
                              src={url}
                              alt=""
                              className="rounded-lg max-w-full cursor-pointer hover:opacity-90 transition-opacity"
                              style={{ maxHeight: 300, objectFit: "contain" }}
                              onClick={() => setLightboxState({ urls: imageUrls, index: i })}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="text-muted text-sm text-center py-8">
                <p>固定メモはまだありません</p>
                <p className="text-xs mt-1">チャンネルの目的やリンクを短く残せます</p>
              </div>
            )}
            <button
              onClick={() => { setEditContent(content); setIsEditing(true); }}
              className="mt-4 flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground hover:border-accent/30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              メモを編集
            </button>
          </div>
        )}
      </div>

      {/* 画像ライトボックス */}
      {lightboxState && (
        <ImageLightbox
          mediaList={lightboxState.urls.map((u) => ({ url: u }))}
          currentIndex={lightboxState.index}
          onIndexChange={(i) => setLightboxState({ ...lightboxState, index: i })}
          onClose={() => setLightboxState(null)}
        />
      )}
    </div>
  );
}
