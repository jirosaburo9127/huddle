"use client";

import { useState } from "react";
import type { BoardNoteWithProfile } from "@/lib/supabase/types";
import { BoardChatPanel } from "./board-chat-panel";
import { BoardCanvas } from "./board-canvas";

type Props = {
  notes: BoardNoteWithProfile[];
  onSubmit: (content: string) => void;
  disabled?: boolean;
};

export function BoardLayout({ notes, onSubmit, disabled }: Props) {
  // モバイルのタブ切替
  const [mobileTab, setMobileTab] = useState<"chat" | "board">("chat");

  return (
    <>
      {/* デスクトップ: 2カラム */}
      <div className="hidden lg:flex flex-1 min-h-0">
        {/* 左: チャットパネル */}
        <div className="w-80 border-r border-border flex flex-col shrink-0">
          <BoardChatPanel notes={notes} onSubmit={onSubmit} disabled={disabled} />
        </div>
        {/* 右: 付箋ボード */}
        <BoardCanvas notes={notes} />
      </div>

      {/* モバイル: タブ切替 */}
      <div className="flex flex-col flex-1 min-h-0 lg:hidden">
        {/* タブバー */}
        <div className="flex border-b border-border/50 shrink-0">
          <button
            onClick={() => setMobileTab("chat")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mobileTab === "chat"
                ? "text-foreground border-b-2 border-accent -mb-px"
                : "text-muted"
            }`}
          >
            💬 チャット
          </button>
          <button
            onClick={() => setMobileTab("board")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
              mobileTab === "board"
                ? "text-foreground border-b-2 border-accent -mb-px"
                : "text-muted"
            }`}
          >
            📋 ボード
            {notes.length > 0 && (
              <span className="ml-1 text-[10px] bg-accent/20 text-accent rounded-full px-1.5">
                {notes.length}
              </span>
            )}
          </button>
        </div>

        {/* タブ内容 */}
        {mobileTab === "chat" ? (
          <BoardChatPanel notes={notes} onSubmit={onSubmit} disabled={disabled} />
        ) : (
          <BoardCanvas notes={notes} />
        )}
      </div>
    </>
  );
}
