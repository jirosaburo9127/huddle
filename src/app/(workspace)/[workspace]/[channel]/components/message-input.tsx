"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ファイルサイズ上限: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type Props = {
  channelName?: string;
  onSend: (content: string) => void | Promise<void>;
  placeholder?: string;
  channelId?: string; // ファイルアップロード用
};

export function MessageInput({ channelName, onSend, placeholder, channelId }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setContent("");

    // テキストエリアの高さをリセット
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // IME変換中のEnterは無視（日本語入力の確定操作）
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  // テキストエリアの自動リサイズ
  function handleInput() {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }

  // ファイル選択ハンドラ
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("ファイルサイズは10MB以下にしてください");
      // input をリセット
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      const path = `${channelId || "general"}/${crypto.randomUUID()}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from("chat-files")
        .upload(path, file);

      if (uploadErr) {
        setUploadError(`アップロード失敗: ${uploadErr.message}`);
        return;
      }

      // 公開URLを取得してメッセージとして送信
      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);

      await onSend(urlData.publicUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
      // input をリセット
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="shrink-0 px-4 pb-4">
      {/* アップロードエラー表示 */}
      {uploadError && (
        <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="text-red-400 hover:text-red-300 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-xl border border-border bg-input-bg px-3 py-2"
      >
        {/* ファイル添付ボタン */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-lg p-2 text-muted hover:text-accent disabled:opacity-50 transition-colors"
          title="ファイルを添付"
        >
          {uploading ? (
            // アップロード中のスピナー
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            // 📎 クリップアイコン
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
        </button>

        {/* 非表示のファイルinput */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.json,.xml"
        />

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder || (channelName ? `#${channelName} にメッセージを送信` : "メッセージを入力")}
          rows={1}
          className="flex-1 resize-none bg-transparent text-lg text-foreground placeholder-muted focus:outline-none max-h-[200px]"
        />
        <button
          type="submit"
          disabled={!content.trim()}
          className="shrink-0 rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:opacity-30 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  );
}
