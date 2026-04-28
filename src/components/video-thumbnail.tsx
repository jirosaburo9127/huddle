"use client";

import { useEffect, useRef, useState } from "react";

// 動画ファイルから1フレームをキャプチャしてサムネイル画像を生成する。
// iOS Safari / Chrome / Firefox いずれでも一貫してサムネイルが出るように、
// hidden な <video> を作って seeked → canvas.drawImage → dataURL で表示する。
//
// chat-files Bucket は public なので crossOrigin = anonymous で canvas に
// 描画して toDataURL しても tainted にならない（Supabase 側 CORS = *）。

// メモリ上のサムネイルキャッシュ（同じ url は再キャプチャしない）
const thumbCache = new Map<string, string>();

type Props = {
  url: string;
  className?: string;
  /** キャプチャする秒数（既定 0.5 秒） */
  captureAt?: number;
};

export function VideoThumbnail({ url, className, captureAt = 0.5 }: Props) {
  const [thumb, setThumb] = useState<string | null>(() => thumbCache.get(url) ?? null);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (thumbCache.has(url)) {
      setThumb(thumbCache.get(url)!);
      return;
    }
    let cancelled = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    // iOS Safari でフルスクリーン化させずインライン読み込み
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.src = url;
    ref.current = video;

    const onLoadedData = () => {
      if (cancelled) return;
      // 動画によっては 0 秒は黒フレームのことがあるので少し進めてから描画
      try {
        video.currentTime = Math.min(captureAt, Math.max(0, (video.duration || 1) * 0.1));
      } catch {
        video.currentTime = captureAt;
      }
    };

    const onSeeked = () => {
      if (cancelled) return;
      try {
        const w = video.videoWidth || 320;
        const h = video.videoHeight || 320;
        const canvas = document.createElement("canvas");
        // 縮小しながら描画（サムネは小さく、メモリ節約）
        const targetW = 480;
        const scale = targetW / w;
        canvas.width = targetW;
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        thumbCache.set(url, dataUrl);
        if (!cancelled) setThumb(dataUrl);
      } catch {
        // tainted canvas など失敗時は無視（プレースホルダのまま）
      }
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("seeked", onSeeked);

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("seeked", onSeeked);
      // 開放
      video.src = "";
      ref.current = null;
    };
  }, [url, captureAt]);

  if (thumb) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={thumb} alt="" className={className} loading="lazy" />;
  }

  // キャプチャ中・失敗時のプレースホルダ（ダーク背景）
  return <div className={className} style={{ background: "#1a1a22" }} aria-hidden />;
}
