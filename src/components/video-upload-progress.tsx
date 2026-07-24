"use client";

import { useEffect, useState } from "react";

// 動画の圧縮／アップロード中に、画面中央へ進捗オーバーレイを出す。
// - video-compressor が開始/終了に huddle:videoUploadState {active} を dispatch
// - ネイティブが huddle:nativeVideoProgress {phase, progress, index, total} を dispatch
// ホストを (workspace)/[workspace]/layout.tsx に1つマウントする。

interface ProgressDetail {
  phase: "compress" | "upload";
  progress: number; // 0.0 - 1.0
  index: number;
  total: number;
}

export function VideoUploadProgressHost() {
  const [active, setActive] = useState(false);
  const [detail, setDetail] = useState<ProgressDetail | null>(null);

  useEffect(() => {
    const onState = (e: Event) => {
      const d = (e as CustomEvent<{ active: boolean }>).detail;
      setActive(!!d?.active);
      if (!d?.active) setDetail(null);
    };
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent<ProgressDetail>).detail;
      if (d) setDetail(d);
    };
    window.addEventListener("huddle:videoUploadState", onState);
    window.addEventListener("huddle:nativeVideoProgress", onProgress);
    return () => {
      window.removeEventListener("huddle:videoUploadState", onState);
      window.removeEventListener("huddle:nativeVideoProgress", onProgress);
    };
  }, []);

  if (!active) return null;

  const phaseLabel = detail?.phase === "upload" ? "アップロード中" : "圧縮中";
  const pct = detail ? Math.round(detail.progress * 100) : null;
  const multi = detail && detail.total > 1 ? `（${detail.index + 1}/${detail.total}）` : "";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl px-6 py-5 w-[min(88vw,340px)] shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-sm font-medium">
            {detail ? `${phaseLabel}${multi}` : "動画を処理中…"}
            {pct !== null ? ` ${pct}%` : ""}
          </span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-black/10 overflow-hidden">
          {pct !== null ? (
            <div className="h-full bg-accent transition-all duration-200" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/3 bg-accent rounded-full animate-pulse" />
          )}
        </div>
        <p className="mt-2 text-xs text-muted">大きい動画は数分かかることがあります</p>
      </div>
    </div>
  );
}
