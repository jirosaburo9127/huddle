"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

// 動画ファイルのサムネイル表示。
//
// iOS WKWebView では autoplay が拒否されると <video> が斜線入りの「再生不可」
// アイコンを OS 標準で表示してしまう（CSS では完全に隠しきれない）。
// そのため iOS ネイティブ環境では <video> 自体を opacity 0 で隠し、
// 親側で重ねてある ▶ オーバーレイだけ見せる。PC ブラウザではフレームが
// サムネとして表示される。

type Props = {
  url: string;
  className?: string;
  /** 表示するフレームの秒数（既定 0.1） */
  captureAt?: number;
};

export function VideoThumbnail({ url, className, captureAt = 0.1 }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // SSR/hydration では false（PC のフォールバック挙動）にしておき、
  // mount 後に Capacitor 判定でネイティブのみ非表示化
  const [hideForNative, setHideForNative] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) setHideForNative(true);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.readyState >= 2) {
      try {
        v.pause();
        if (v.currentTime === 0) v.currentTime = captureAt;
      } catch {
        // 無視
      }
    }
  }, [url, captureAt]);

  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      autoPlay
      preload="auto"
      className={`${className ?? ""} video-thumbnail`}
      style={{
        pointerEvents: "none",
        opacity: hideForNative ? 0 : 1,
      }}
      onLoadedData={(e) => {
        const v = e.currentTarget;
        try {
          v.pause();
          v.currentTime = captureAt;
        } catch {
          // 無視
        }
      }}
      onCanPlay={(e) => {
        const v = e.currentTarget;
        if (!v.paused) {
          try {
            v.pause();
          } catch {
            // 無視
          }
        }
      }}
    />
  );
}
