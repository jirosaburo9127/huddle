"use client";

import { useState, useRef, useEffect } from "react";
import type { BoardNoteWithProfile } from "@/lib/supabase/types";

type Props = {
  notes: BoardNoteWithProfile[];
  onSubmit: (content: string) => void;
  disabled?: boolean;
};

export function BoardChatPanel({ notes, onSubmit, disabled }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 新しいノートが追加されたら最下部へスクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [notes.length]);

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
    <div className="flex flex-col h-full">
      {/* 投稿履歴 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {notes.length === 0 ? (
          <div className="text-center text-muted text-xs py-8">
            <p>アイディアを入力してください</p>
            <p className="mt-1 text-muted/60">付箋としてボードに表示されます</p>
          </div>
        ) : (
          notes.map((note) => {
            const name = note.profiles?.display_name || "メンバー";
            return (
              <div key={note.id} className="flex gap-2 items-start">
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                  {note.profiles?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={note.profiles.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <span className="text-[9px] font-bold text-accent">{name[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-foreground truncate">{name}</span>
                    {note.category && (
                      <span className="text-[9px] text-accent bg-accent/10 rounded px-1">
                        {note.category}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{note.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 入力エリア */}
      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-border/50">
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
