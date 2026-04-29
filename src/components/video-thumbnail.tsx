"use client";

import { useEffect, useRef } from "react";

// 動画ファイルのサムネイル表示。
// iOS WKWebView は <video> の preload="metadata" や #t=0.1 メディアフラグメントを
// 律儀に守ってくれず、最初のフレームが黒のままになる。確実にフレームを描画させるため、
// autoplay + muted で一瞬再生 → onLoadedData で pause + 0.1秒地点に seek する。
//
// pointer-events: none で親要素のクリックを通すので、サムネ全体をクリッカブルな
// カードにできる。

type Props = {
  url: string;
  className?: string;
  /** 表示するフレームの秒数（既定 0.1） */
  captureAt?: number;
};

export function VideoThumbnail({ url, className, captureAt = 0.1 }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // マウント直後にフレームを確実に描画させる
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // 既に loadeddata 済みなら直接 seek + pause（再マウント時の救済）
    if (v.readyState >= 2) {
      try {
        v.pause();
        if (v.currentTime === 0) v.currentTime = captureAt;
      } catch {
        // 失敗は無視
      }
    }
  }, [url, captureAt]);

  // globals.css の .video-thumbnail で iOS Safari の斜線入り再生不可アイコンを隠す
  return (
    <video
      ref={ref}
      src={url}
      muted
      // iOS Safari でフルスクリーン化させない
      playsInline
      autoPlay
      preload="auto"
      className={`${className ?? ""} video-thumbnail`}
      style={{ pointerEvents: "none" }}
      onLoadedData={(e) => {
        // autoplay で一瞬走り出した動画を即停止して、フレームをサムネとして固定
        const v = e.currentTarget;
        try {
          v.pause();
          v.currentTime = captureAt;
        } catch {
          // 失敗時はそのまま（最初フレームのまま）
        }
      }}
      onCanPlay={(e) => {
        // 一部ブラウザは onLoadedData では pause できないので保険
        const v = e.currentTarget;
        if (!v.paused) {
          try {
            v.pause();
          } catch {
            // 失敗は無視
          }
        }
      }}
    />
  );
}
