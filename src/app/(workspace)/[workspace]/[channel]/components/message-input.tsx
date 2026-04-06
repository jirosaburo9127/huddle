"use client";

import { useState, useRef } from "react";

type Props = {
  channelName?: string;
  onSend: (content: string) => void | Promise<void>;
  placeholder?: string;
};

export function MessageInput({ channelName, onSend, placeholder }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div className="shrink-0 px-4 pb-4">
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-xl border border-border bg-input-bg px-3 py-2"
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder || (channelName ? `#${channelName} にメッセージを送信` : "メッセージを入力")}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder-muted focus:outline-none max-h-[200px]"
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
