"use client";

import { useState, useRef } from "react";
import type { BoardNoteWithProfile } from "@/lib/supabase/types";
import { BoardCanvas } from "./board-canvas";

type Props = {
  notes: BoardNoteWithProfile[];
  onSubmit: (content: string) => void;
  disabled?: boolean;
};

export function BoardLayout({ notes, onSubmit, disabled }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setInput("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 付箋ボード（全面表示） */}
      <BoardCanvas notes={notes} />

      {/* 入力欄（下部固定） */}
      <div className="shrink-0 px-4 pb-3 pt-2 border-t border-border/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="アイディアを入力..."
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            style={{ maxHeight: 120 }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || disabled}
            className="shrink-0 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            投稿
          </button>
        </div>
      </div>
    </div>
  );
}
