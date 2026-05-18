"use client";

import { useEffect, useRef, useState } from "react";

// 動画ファイルのサムネイル表示。
//
// iOS WKWebView では autoplay が拒否されると <video> が斜線入りの「再生不可」
// アイコンを OS 標準で表示してしまう（CSS では完全に隠しきれない）。
// まず <video> の first frame を見せ、可能なら canvas に焼いた poster を重ねる。
// Storage の CORS 条件で canvas 化できない動画でも、黒い空白にはしない。

type Props = {
  url: string;
  className?: string;
  /** 表示するフレームの秒数（既定 0.1） */
  captureAt?: number;
};

export function VideoThumbnail({ url, className, captureAt = 0.1 }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const videoSrc = `${url}#t=${captureAt}`;

  useEffect(() => {
    setPosterUrl(null);
    setFailed(false);
    const v = ref.current;
    if (!v) return;
    const video = v;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function drawFrame() {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas context unavailable");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (!cancelled) setPosterUrl(dataUrl);
      } catch {
        // CORS 未許可の動画では canvas が taint される。その場合も下の
        // <video> フォールバックを見せるので、ここでは失敗表示にしない。
      } finally {
        try {
          video.pause();
        } catch {
          // ignore
        }
      }
    }

    function seekToFrame() {
      if (cancelled) return;
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const target = duration > 0 ? Math.min(captureAt, Math.max(0, duration - 0.05)) : 0;
        if (Math.abs(video.currentTime - target) < 0.01) {
          drawFrame();
        } else {
          video.currentTime = target;
        }
      } catch {
        drawFrame();
      }
    }

    function markFailed() {
      if (!cancelled) setFailed(true);
    }

    video.addEventListener("loadedmetadata", seekToFrame);
    video.addEventListener("loadeddata", seekToFrame);
    video.addEventListener("seeked", drawFrame);
    video.addEventListener("error", markFailed);

    timeout = setTimeout(markFailed, 8000);
    video.load();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", seekToFrame);
      video.removeEventListener("loadeddata", seekToFrame);
      video.removeEventListener("seeked", drawFrame);
      video.removeEventListener("error", markFailed);
    };
  }, [url, captureAt]);

  return (
    <div className={`${className ?? ""} relative overflow-hidden bg-gradient-to-br from-zinc-800 to-black`}>
      <video
        ref={ref}
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        controls={false}
        className="absolute inset-0 w-full h-full object-cover video-thumbnail"
        aria-hidden="true"
      />
      {posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      {failed && !posterUrl && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <svg className="w-10 h-10 text-white/45" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
      )}
    </div>
  );
}
