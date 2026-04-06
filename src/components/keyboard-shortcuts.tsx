"use client";

import { useState, useEffect } from "react";
import { SearchModal } from "@/components/search-modal";

type Props = {
  children: React.ReactNode;
  workspaceId: string;
  workspaceSlug: string;
};

/**
 * キーボードショートカットを管理するラッパーコンポーネント
 * Cmd+K / Ctrl+K で検索モーダルを開閉する
 */
export function KeyboardShortcuts({ children, workspaceId, workspaceSlug }: Props) {
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K (Mac) / Ctrl+K (Win) で検索モーダルをトグル
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
      // Escape で閉じる
      if (e.key === "Escape") {
        setShowSearch(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {children}
      {showSearch && (
        <SearchModal
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowSearch(false)}
        />
      )}
    </>
  );
}
