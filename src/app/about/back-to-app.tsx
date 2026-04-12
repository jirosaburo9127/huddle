"use client";

import { useEffect, useState } from "react";

export function BackToAppBar() {
  // アプリ内から来た場合のみ表示（直接URLアクセスや初回訪問では非表示）
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    // history.length > 2 ならアプリ内から遷移してきた可能性が高い
    // (1 = 初回ロード、2 = リダイレクト経由)
    if (window.history.length > 2) {
      setHasHistory(true);
    }
  }, []);

  if (!hasHistory) return null;

  return (
    <div className="sticky top-0 z-50 bg-[#0f0f1a] text-white text-center py-2 px-4">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="text-sm font-medium hover:underline inline-flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        アプリに戻る
      </button>
    </div>
  );
}
