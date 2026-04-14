"use client";

import { useEffect } from "react";

// 直前に開いていたワークスペースを Cookie に保存する。
// ルート (/) にアクセスされたとき page.tsx がこの Cookie を読み、
// 前回開いていたワークスペースへリダイレクトする。
export function LastWorkspaceTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    // 1 年保持。SameSite=Lax でクロスサイト遷移も許容。
    // httpOnly は付けない (クライアントから書く Cookie なので)。
    document.cookie = `huddle_last_workspace=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}
