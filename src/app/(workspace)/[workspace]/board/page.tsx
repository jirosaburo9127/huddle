"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import type { Board, BoardNote, BoardNoteWithProfile, Profile } from "@/lib/supabase/types";
import { BoardHeader } from "./components/board-header";
import { BoardLayout } from "./components/board-layout";

// プロフィールキャッシュ（ページ内）
const profileCache = new Map<string, Profile>();

export default function BoardPage() {
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;
  const supabase = createClient();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [notes, setNotes] = useState<BoardNoteWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const sentIdsRef = useRef<Set<string>>(new Set());

  // モバイルでサイドバーを閉じる
  useEffect(() => {
    setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初期データ取得
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setCurrentUserId(user.id);

      // ワークスペースID解決
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", workspaceSlug)
        .maybeSingle();
      if (!ws || cancelled) return;
      setWorkspaceId(ws.id);

      // アクティブなボードを取得
      const { data: activeBoard } = await supabase
        .from("boards")
        .select("*")
        .eq("workspace_id", ws.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;

      if (activeBoard) {
        setBoard(activeBoard as Board);

        // ノート取得（プロフィール付き）
        const { data: noteData } = await supabase
          .from("board_notes")
          .select("*, profiles(*)")
          .eq("board_id", activeBoard.id)
          .order("created_at", { ascending: true });

        if (noteData && !cancelled) {
          const notesWithProfile = noteData as unknown as BoardNoteWithProfile[];
          // プロフィールキャッシュに蓄積
          for (const n of notesWithProfile) {
            if (n.profiles && n.user_id) profileCache.set(n.user_id, n.profiles);
          }
          setNotes(notesWithProfile);
        }
      }

      setLoading(false);
    }

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  // Realtime購読
  useEffect(() => {
    if (!board) return;

    const sub = supabase
      .channel(`board-notes-${board.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_notes",
          filter: `board_id=eq.${board.id}`,
        },
        (payload: RealtimePostgresInsertPayload<BoardNote>) => {
          const newNote = payload.new;
          // 自分の楽観的追加と重複しない
          if (sentIdsRef.current.has(newNote.id)) {
            sentIdsRef.current.delete(newNote.id);
            return;
          }
          const profile = profileCache.get(newNote.user_id) ?? null;
          setNotes((prev) => {
            if (prev.some((n) => n.id === newNote.id)) return prev;
            return [...prev, { ...newNote, profiles: profile }];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_notes",
          filter: `board_id=eq.${board.id}`,
        },
        (payload: RealtimePostgresUpdatePayload<BoardNote>) => {
          const updated = payload.new;
          // カテゴリ分類結果の反映
          setNotes((prev) =>
            prev.map((n) =>
              n.id === updated.id ? { ...n, category: updated.category } : n
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  // ノート投稿
  const handleSubmit = useCallback(async (content: string) => {
    if (!board || !currentUserId) return;

    const noteId = crypto.randomUUID();
    sentIdsRef.current.add(noteId);

    // 楽観的追加
    const optimistic: BoardNoteWithProfile = {
      id: noteId,
      board_id: board.id,
      user_id: currentUserId,
      content,
      category: null,
      color: "yellow",
      created_at: new Date().toISOString(),
      profiles: profileCache.get(currentUserId) ?? null,
    };
    setNotes((prev) => [...prev, optimistic]);

    // DB挿入
    const { error } = await supabase.from("board_notes").insert({
      id: noteId,
      board_id: board.id,
      user_id: currentUserId,
      content,
    });

    if (error) {
      sentIdsRef.current.delete(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
  }, [board, currentUserId, supabase]);

  // ボード作成
  const handleCreateBoard = useCallback(async () => {
    if (!workspaceId || !currentUserId) return;
    const title = prompt("ボードのタイトルを入力してください", "付箋ボード");
    if (!title?.trim()) return;

    const { data, error } = await supabase
      .from("boards")
      .insert({
        workspace_id: workspaceId,
        title: title.trim(),
        created_by: currentUserId,
      })
      .select()
      .single();

    if (!error && data) {
      setBoard(data as Board);
      setNotes([]);
    }
  }, [workspaceId, currentUserId, supabase]);

  // ボード終了
  const handleCloseBoard = useCallback(async () => {
    if (!board) return;
    if (!window.confirm("このボードを終了しますか？付箋はアーカイブとして残ります。")) return;

    await supabase
      .from("boards")
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq("id", board.id);

    setBoard(null);
    setNotes([]);
  }, [board, supabase]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <BoardHeader
        board={board}
        noteCount={notes.length}
        onCreateBoard={handleCreateBoard}
        onCloseBoard={handleCloseBoard}
      />
      {board ? (
        <BoardLayout
          notes={notes}
          onSubmit={handleSubmit}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted px-6">
          <div className="text-center">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-base font-medium text-foreground mb-2">付箋ボード</p>
            <p className="text-sm text-muted mb-4">
              チャット形式でアイディアを投稿すると、<br />
              自動でカテゴリ分けされた付箋ボードに変わります
            </p>
            <button
              onClick={handleCreateBoard}
              className="bg-accent text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              ボードを作成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
